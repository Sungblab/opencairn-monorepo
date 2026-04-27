"""StalenessAgent — Plan 8 Temporal/Staleness agent.

Detects stale wiki notes (not updated in N days) by:

1. Fetching stale candidates from the internal API.
2. Scoring each note via LLM (0.0 = current, 1.0 = very likely outdated).
3. Persisting ``stale_alerts`` rows for notes above the score threshold.
4. Publishing a best-effort ``system`` notification for each alert created.

Named ``temporal_agent`` in code to avoid collision with the ``temporalio``
Python package. The Hono API route is ``/api/agents/temporal/stale-check``.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import time
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import datetime, timezone
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

from worker.agents.temporal_agent.prompts import (
    STALENESS_SYSTEM,
    build_staleness_prompt,
)
from worker.lib.api_client import AgentApiClient, get_internal, post_internal

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StalenessInput:
    """Validated input to :class:`StalenessAgent`."""

    workspace_id: str
    project_id: str
    user_id: str
    stale_days: int = 90
    max_notes: int = 20
    score_threshold: float = 0.5


@dataclass
class StaleNoteResult:
    note_id: str
    title: str
    days_old: int
    staleness_score: float
    reason: str
    alert_created: bool


class StalenessAgent(Agent):
    """Detects stale wiki notes and creates staleness alerts.

    Constructed with a live ``LLMProvider`` (Gemini or Ollama) and an
    ``AgentApiClient``. Both are injected so tests can substitute fakes.
    """

    name: ClassVar[str] = "staleness"
    description: ClassVar[str] = (
        "Detects stale wiki notes and creates staleness alerts."
    )

    def __init__(
        self,
        *,
        provider: LLMProvider,
        api: AgentApiClient | None = None,
    ) -> None:
        self.provider = provider
        self.api = api or AgentApiClient()

    async def run(
        self,
        input: dict[str, Any],
        ctx: ToolContext,
    ) -> AsyncGenerator[AgentEvent, None]:
        validated = StalenessInput(
            workspace_id=input["workspace_id"],
            project_id=input["project_id"],
            user_id=input["user_id"],
            stale_days=int(input.get("stale_days", 90)),
            max_notes=int(input.get("max_notes", 20)),
            score_threshold=float(input.get("score_threshold", 0.5)),
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

        try:
            # 1. Fetch stale note candidates.
            fetch_call_id = f"call-{uuid.uuid4().hex[:8]}"
            fetch_args = {
                "project_id": validated.project_id,
                "days": validated.stale_days,
                "limit": validated.max_notes,
            }
            yield ToolUse(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_use",
                tool_call_id=fetch_call_id,
                tool_name="fetch_stale_notes",
                input_args=fetch_args,
                input_hash=hash_input(fetch_args),
                concurrency_safe=True,
            )
            fetch_started = time.time()
            candidates_raw = await get_internal(
                f"/api/internal/projects/{validated.project_id}/stale-notes"
                f"?days={validated.stale_days}&limit={validated.max_notes}"
            )
            candidates = candidates_raw.get("notes", [])
            yield ToolResult(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="tool_result",
                tool_call_id=fetch_call_id,
                ok=True,
                output={"candidates": len(candidates)},
                duration_ms=int((time.time() - fetch_started) * 1000),
            )

            # 2. Score all candidates via LLM in parallel (max 5 concurrent).
            notes_checked = 0
            alerts_created = 0
            results: list[StaleNoteResult] = []

            _llm_sem = asyncio.Semaphore(5)

            # Precompute per-note metadata and emit all ToolUse events upfront.
            note_meta = []
            score_call_ids = []
            for note in candidates:
                note_id = str(note.get("id", ""))
                title = str(note.get("title", "Untitled"))
                content_text = str(note.get("contentText") or "")
                days_old = _days_since(note.get("updatedAt"))
                note_meta.append((note_id, title, content_text, days_old))

                score_call_id = f"call-{uuid.uuid4().hex[:8]}"
                score_call_ids.append(score_call_id)
                score_args = {"note_id": note_id, "title": title}
                yield ToolUse(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="tool_use",
                    tool_call_id=score_call_id,
                    tool_name="score_staleness",
                    input_args=score_args,
                    input_hash=hash_input(score_args),
                    concurrency_safe=True,
                )

            async def _score_note(
                note_id: str, title: str, content_text: str, days_old: int
            ) -> tuple[str, int, Exception | None]:
                t0 = time.time()
                async with _llm_sem:
                    try:
                        raw = await self.provider.generate(
                            [
                                {"role": "system", "content": STALENESS_SYSTEM},
                                {
                                    "role": "user",
                                    "content": build_staleness_prompt(
                                        title, content_text, days_old
                                    ),
                                },
                            ],
                            response_mime_type="application/json",
                        )
                        return raw, int((time.time() - t0) * 1000), None
                    except Exception as exc:  # noqa: BLE001
                        return "", int((time.time() - t0) * 1000), exc

            llm_responses = await asyncio.gather(
                *[_score_note(nid, ti, ct, do) for nid, ti, ct, do in note_meta]
            )

            # Emit ModelEnd + ToolResult for each LLM result.
            for (note_id, title, content_text, days_old), score_call_id, (
                raw_response,
                latency_ms,
                exc,
            ) in zip(note_meta, score_call_ids, llm_responses):
                if exc is not None:
                    logger.warning(
                        "StalenessAgent: LLM scoring failed for note=%r: %s",
                        note_id,
                        exc,
                    )
                    yield ToolResult(
                        run_id=ctx.run_id,
                        workspace_id=ctx.workspace_id,
                        agent_name=self.name,
                        seq=seq.next(),
                        ts=time.time(),
                        type="tool_result",
                        tool_call_id=score_call_id,
                        ok=False,
                        output={"error": str(exc)},
                        duration_ms=latency_ms,
                    )
                    results.append(
                        StaleNoteResult(
                            note_id=note_id,
                            title=title,
                            days_old=days_old,
                            staleness_score=0.0,
                            reason="llm_error",
                            alert_created=False,
                        )
                    )
                    continue

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
                parsed = _parse_staleness_response(raw_response)
                staleness_score = float(parsed.get("score", 0.0))
                reason = str(parsed.get("reason", ""))
                notes_checked += 1
                yield ToolResult(
                    run_id=ctx.run_id,
                    workspace_id=ctx.workspace_id,
                    agent_name=self.name,
                    seq=seq.next(),
                    ts=time.time(),
                    type="tool_result",
                    tool_call_id=score_call_id,
                    ok=True,
                    output={"score": staleness_score},
                    duration_ms=latency_ms,
                )

                # 3. Persist alert if above threshold.
                alert_created = False
                if staleness_score >= validated.score_threshold:
                    alert_call_id = f"call-{uuid.uuid4().hex[:8]}"
                    alert_args = {"note_id": note_id, "score": staleness_score}
                    yield ToolUse(
                        run_id=ctx.run_id,
                        workspace_id=ctx.workspace_id,
                        agent_name=self.name,
                        seq=seq.next(),
                        ts=time.time(),
                        type="tool_use",
                        tool_call_id=alert_call_id,
                        tool_name="create_stale_alert",
                        input_args=alert_args,
                        input_hash=hash_input(alert_args),
                        concurrency_safe=False,
                    )
                    alert_started = time.time()
                    try:
                        await post_internal(
                            "/api/internal/stale-alerts",
                            {
                                "noteId": note_id,
                                "stalenessScore": staleness_score,
                                "reason": reason[:500],
                            },
                        )
                        alert_created = True
                        alerts_created += 1
                        yield ToolResult(
                            run_id=ctx.run_id,
                            workspace_id=ctx.workspace_id,
                            agent_name=self.name,
                            seq=seq.next(),
                            ts=time.time(),
                            type="tool_result",
                            tool_call_id=alert_call_id,
                            ok=True,
                            output={"alert_created": True},
                            duration_ms=int((time.time() - alert_started) * 1000),
                        )

                        # 4. Best-effort notification (i18n key stored in payload).
                        with contextlib.suppress(Exception):
                            await post_internal(
                                "/api/internal/notifications",
                                {
                                    "userId": validated.user_id,
                                    "kind": "system",
                                    "payload": {
                                        "summaryKey": "notifications.staleAlert",
                                        "summaryParams": {
                                            "title": title,
                                            "score": f"{staleness_score:.2f}",
                                        },
                                        "level": "warning",
                                        "refType": "stale_alert",
                                        "refId": note_id,
                                    },
                                },
                            )

                    except Exception as exc:  # noqa: BLE001
                        logger.warning(
                            "StalenessAgent: failed to create alert for note=%r: %s",
                            note_id,
                            exc,
                        )
                        yield ToolResult(
                            run_id=ctx.run_id,
                            workspace_id=ctx.workspace_id,
                            agent_name=self.name,
                            seq=seq.next(),
                            ts=time.time(),
                            type="tool_result",
                            tool_call_id=alert_call_id,
                            ok=False,
                            output={"error": str(exc)},
                            duration_ms=int((time.time() - alert_started) * 1000),
                        )

                results.append(
                    StaleNoteResult(
                        note_id=note_id,
                        title=title,
                        days_old=days_old,
                        staleness_score=staleness_score,
                        reason=reason,
                        alert_created=alert_created,
                    )
                )

            # 5. Emit stats CustomEvent.
            yield CustomEvent(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="custom",
                label="staleness.completed",
                payload={
                    "candidates": len(candidates),
                    "notes_checked": notes_checked,
                    "alerts_created": alerts_created,
                    "project_id": validated.project_id,
                    "stale_days": validated.stale_days,
                },
            )

            output: dict[str, Any] = {
                "candidates": len(candidates),
                "notes_checked": notes_checked,
                "alerts_created": alerts_created,
            }
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
            logger.exception(
                "StalenessAgent failed for project=%r", validated.project_id
            )
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
# Module-private helpers
# ---------------------------------------------------------------------------


class _SeqCounter:
    __slots__ = ("_value",)

    def __init__(self) -> None:
        self._value = -1

    def next(self) -> int:
        self._value += 1
        return self._value


_JSON_BLOCK = re.compile(r"```(?:json)?\s*(.+?)```", re.DOTALL)


def _strip_fence(raw: str) -> str:
    if not raw:
        return ""
    text = raw.strip()
    m = _JSON_BLOCK.search(text)
    return m.group(1).strip() if m else text


def _parse_staleness_response(raw: str) -> dict[str, Any]:
    """Parse LLM JSON response into a ``{score, reason}`` dict.

    Returns ``{"score": 0.0, "reason": "parse_error"}`` on any failure so the
    caller can always dereference both keys without guarding.
    """
    text = _strip_fence(raw or "")
    if not text:
        return {"score": 0.0, "reason": "empty_response"}
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("StalenessAgent: LLM response was not JSON: %r", raw[:200])
        return {"score": 0.0, "reason": "parse_error"}
    if not isinstance(payload, dict):
        return {"score": 0.0, "reason": "parse_error"}
    raw_score = payload.get("score", 0.0)
    try:
        score = float(raw_score)
    except (TypeError, ValueError):
        score = 0.0
    score = max(0.0, min(1.0, score))
    reason = str(payload.get("reason", "")).strip()[:500]
    return {"score": score, "reason": reason}


def _days_since(updated_at_raw: Any) -> int:
    """Return how many days ago ``updated_at_raw`` (ISO string or None) was."""
    if not updated_at_raw:
        return 0
    try:
        if isinstance(updated_at_raw, str):
            # Handle both naive and aware ISO strings.
            ts_str = updated_at_raw.replace("Z", "+00:00")
            dt = datetime.fromisoformat(ts_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        else:
            return 0
        now = datetime.now(timezone.utc)
        delta = now - dt
        return max(0, delta.days)
    except (ValueError, TypeError):
        return 0


def _is_retryable(exc: Exception) -> bool:
    import httpx

    if isinstance(exc, httpx.HTTPStatusError):
        return 500 <= exc.response.status_code < 600
    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)):
        return True
    return False
