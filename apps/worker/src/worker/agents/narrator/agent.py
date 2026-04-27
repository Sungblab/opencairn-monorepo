"""NarratorAgent — 2-speaker podcast audio generator.

Given a wiki note, the agent:
1. Fetches the note's content via the internal API.
2. Calls the LLM to produce a Host/Guest dialogue script (JSON).
3. Calls provider.tts() to synthesise the script (Gemini only; graceful
   degrade on Ollama returns None).
4. Uploads the audio bytes to MinIO/S3 (only when TTS was available).
5. Saves a record to the ``audio_files`` table via the internal API.
6. Returns ``{ audio_file_id, r2_key, script, has_audio }`` — or just
   ``{ script, has_audio: false }`` when TTS is unavailable.

Follows the runtime.Agent contract (Plan 12) so the event stream is
observed by the trajectory writer + token counter hooks exactly as any
other agent in the platform.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import time
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any, ClassVar

from llm import LLMProvider

from runtime.agent import Agent
from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    CustomEvent,
    ModelEnd,
    ToolResult,
    ToolUse,
)
from runtime.tools import ToolContext, hash_input

from worker.agents.narrator.prompts import (
    SCRIPT_SYSTEM,
    _script_to_text,
    build_script_prompt,
)
from worker.lib.api_client import AgentApiClient, get_internal, post_internal

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class NarratorInput:
    """Validated input to :class:`NarratorAgent`."""

    note_id: str
    project_id: str
    workspace_id: str
    user_id: str
    style: str = "conversational"
    max_duration_sec: int = 900


class NarratorAgent(Agent):
    """Generates podcast-style audio from a wiki note.

    Constructed with a live ``LLMProvider`` (Gemini or Ollama) and an
    ``AgentApiClient``. Both are injected so tests can substitute fakes.
    """

    name: ClassVar[str] = "narrator"
    description: ClassVar[str] = (
        "Generates 2-speaker podcast audio from a wiki note."
    )

    def __init__(
        self,
        *,
        provider: LLMProvider,
        api: AgentApiClient | None = None,
    ) -> None:
        self.provider = provider
        self.api = api or AgentApiClient()

    # -- public entrypoint ---------------------------------------------------

    async def run(
        self,
        input: dict[str, Any],
        ctx: ToolContext,
    ) -> AsyncGenerator[AgentEvent, None]:
        validated = NarratorInput(
            note_id=input["note_id"],
            project_id=input["project_id"],
            workspace_id=input["workspace_id"],
            user_id=input["user_id"],
            style=input.get("style", "conversational"),
            max_duration_sec=int(
                input.get(
                    "max_duration_sec",
                    os.environ.get("NARRATOR_MAX_DURATION_SEC", "900"),
                )
            ),
        )

        t0 = time.time()
        seq = _SeqCounter()

        yield AgentStart(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=t0,
            scope=ctx.scope,
            input=dict(input),
        )

        audio_file_id: str | None = None
        r2_key: str | None = None
        script: list[dict] = []
        audio_bytes: bytes | None = None

        try:
            # ------------------------------------------------------------------
            # Step 1: Fetch note
            # ------------------------------------------------------------------
            fetch_call_id = f"call-{uuid.uuid4().hex[:8]}"
            fetch_args = {"note_id": validated.note_id}
            yield ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=fetch_call_id,
                tool_name="fetch_note",
                input_args=fetch_args,
                input_hash=hash_input(fetch_args),
                concurrency_safe=True,
            )
            fetch_started = time.time()
            note = await get_internal(f"/api/internal/notes/{validated.note_id}")
            content_text: str = note.get("contentText") or ""
            note_title: str = note.get("title") or "Untitled"
            yield ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=fetch_call_id,
                ok=True,
                output={"title": note_title, "chars": len(content_text)},
                duration_ms=int((time.time() - fetch_started) * 1000),
            )

            # ------------------------------------------------------------------
            # Step 2: Generate script via LLM
            # ------------------------------------------------------------------
            script_call_id = f"call-{uuid.uuid4().hex[:8]}"
            script_args = {"style": validated.style}
            yield ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=script_call_id,
                tool_name="generate_script",
                input_args=script_args,
                input_hash=hash_input(script_args),
                concurrency_safe=True,
            )
            system_prompt = SCRIPT_SYSTEM.format(style=validated.style)
            messages = [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": build_script_prompt(
                        note_title, content_text, validated.style
                    ),
                },
            ]
            llm_started = time.time()
            raw_script = await self.provider.generate(
                messages, response_mime_type="application/json"
            )
            latency_ms = int((time.time() - llm_started) * 1000)

            yield ModelEnd(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="model_end",
                model_id=self.provider.config.model or "unknown",
                prompt_tokens=0,
                completion_tokens=0,
                cached_tokens=0,
                cost_krw=0,
                finish_reason="stop",
                latency_ms=latency_ms,
            )

            script = _parse_script(raw_script)
            yield ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=script_call_id,
                ok=True,
                output={"turns": len(script)},
                duration_ms=int((time.time() - llm_started) * 1000),
            )

            # ------------------------------------------------------------------
            # Step 3: Synthesise speech (graceful degrade — Ollama → None)
            # ------------------------------------------------------------------
            tts_call_id = f"call-{uuid.uuid4().hex[:8]}"
            tts_args: dict[str, Any] = {}
            yield ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=tts_call_id,
                tool_name="synthesize_speech",
                input_args=tts_args,
                input_hash=hash_input(tts_args),
                concurrency_safe=True,
            )
            tts_started = time.time()
            audio_bytes = await self.provider.tts(_script_to_text(script))
            yield ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=tts_call_id,
                ok=True,
                output={"audio_bytes": len(audio_bytes) if audio_bytes else 0},
                duration_ms=int((time.time() - tts_started) * 1000),
            )

            # ------------------------------------------------------------------
            # Step 4: Upload to S3 + save audio_files record (only if TTS ran)
            # ------------------------------------------------------------------
            if audio_bytes:
                r2_key = (
                    f"audio/{validated.workspace_id}/{uuid.uuid4()}.mp3"
                )
                upload_call_id = f"call-{uuid.uuid4().hex[:8]}"
                upload_args = {"r2_key": r2_key}
                yield ToolUse(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="tool_use",
                    tool_call_id=upload_call_id,
                    tool_name="upload_audio",
                    input_args=upload_args,
                    input_hash=hash_input(upload_args),
                    concurrency_safe=False,
                )
                upload_started = time.time()

                # Run synchronous MinIO upload in a thread executor so the
                # async event loop stays unblocked.
                await asyncio.get_running_loop().run_in_executor(
                    None, _sync_upload, audio_bytes, r2_key
                )

                # Persist the audio_files record via the internal API.
                result = await post_internal(
                    "/api/internal/audio-files",
                    {
                        "noteId": validated.note_id,
                        "r2Key": r2_key,
                        "voices": [
                            {"name": "Kore", "style": validated.style}
                        ],
                    },
                )
                audio_file_id = result["id"]

                yield ToolResult(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="tool_result",
                    tool_call_id=upload_call_id,
                    ok=True,
                    output={"r2_key": r2_key, "audio_file_id": audio_file_id},
                    duration_ms=int((time.time() - upload_started) * 1000),
                )

            # ------------------------------------------------------------------
            # Step 5: CustomEvent + AgentEnd
            # ------------------------------------------------------------------
            yield CustomEvent(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="custom",
                label="narrator.completed",
                payload={
                    "has_audio": audio_bytes is not None,
                    "script_turns": len(script),
                },
            )

            output: dict[str, Any] = {
                "script": script,
                "has_audio": audio_bytes is not None,
            }
            if audio_file_id is not None:
                output["audio_file_id"] = audio_file_id
            if r2_key is not None:
                output["r2_key"] = r2_key

            yield AgentEnd(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="agent_end",
                output=output,
                duration_ms=int((time.time() - t0) * 1000),
            )

        except Exception as exc:  # noqa: BLE001
            logger.exception("NarratorAgent failed")
            yield AgentError(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="agent_error",
                error_class=type(exc).__name__,
                message=str(exc),
                retryable=_is_retryable(exc),
            )
            raise


# ---------------------------------------------------------------------------
# Helpers (module-private)
# ---------------------------------------------------------------------------


class _SeqCounter:
    __slots__ = ("_value",)

    def __init__(self) -> None:
        self._value = -1

    def next(self) -> int:
        self._value += 1
        return self._value


def _parse_script(raw: str) -> list[dict]:
    """Parse the LLM's JSON output into a list of speaker turns.

    On any parse error, returns an empty list rather than raising — the agent
    will still emit a ``has_audio=False`` result with an empty script.
    """
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            logger.warning("NarratorAgent: script JSON is not a list")
            return []
        validated: list[dict] = []
        for turn in data:
            if isinstance(turn, dict) and "speaker" in turn and "text" in turn:
                validated.append(
                    {
                        "speaker": str(turn["speaker"]).lower(),
                        "text": str(turn["text"]),
                    }
                )
        return validated
    except json.JSONDecodeError as exc:
        logger.warning("NarratorAgent: failed to parse script JSON: %s", exc)
        return []


def _sync_upload(audio_bytes: bytes, r2_key: str) -> None:
    """Synchronous MinIO upload — called from a thread executor."""
    from worker.lib.s3_client import get_s3_client

    bucket = os.environ.get("S3_BUCKET", "opencairn-uploads")
    client = get_s3_client()
    client.put_object(
        bucket,
        r2_key,
        data=io.BytesIO(audio_bytes),
        length=len(audio_bytes),
        content_type="audio/mpeg",
    )


def _is_retryable(exc: Exception) -> bool:
    import httpx

    if isinstance(exc, httpx.HTTPStatusError):
        return 500 <= exc.response.status_code < 600
    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)):
        return True
    return False
