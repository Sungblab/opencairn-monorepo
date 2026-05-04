"""``execute_deep_research`` Temporal activity — streaming execution.

The 20-60 min phase:
  - Start a non-collaborative interaction chained from the approved plan.
    (The SDK's ``create`` returns an ``Interaction`` — streaming is a
    separate call to ``stream_interaction(id)`` which wraps ``get(stream=True)``.
    Phase A's signature fix dropped the bogus ``stream=True`` kwarg.)
  - Consume events from ``stream_interaction`` and forward them to
    ``on_event`` (the production callback persists to
    research_run_artifacts + SSE via the internal API).
  - Heartbeat per event so Temporal doesn't consider the activity stalled.
  - Return the consolidated report + ordered image / citation refs.

Returns dicts (not dataclasses) in ``images``/``citations`` so the @activity.defn
payload is plain JSON — avoids needing to register nested dataclasses with
the Temporal data converter.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from temporalio import activity
from temporalio.exceptions import ApplicationError

from worker.activities.deep_research.create_plan import (
    _default_fetch_byok,
    _production_provider_factory,
)
from worker.activities.deep_research.keys import (
    KeyResolutionError,
    resolve_api_key,
)

_NON_RETRYABLE_CODES = {
    "quota_exceeded",
    "invalid_byok_key",
    "401",
    "403",
    "permission_denied",
}


@dataclass
class ExecuteResearchInput:
    run_id: str
    user_id: str
    approved_plan: str
    model: str
    billing_path: str
    previous_interaction_id: str


@dataclass
class ExecuteResearchOutput:
    interaction_id: str
    report_text: str
    images: list[dict[str, str]] = field(default_factory=list)
    citations: list[dict[str, str]] = field(default_factory=list)


class _ProviderLike(Protocol):
    async def start_interaction(self, **kwargs): ...
    async def stream_interaction(
        self, interaction_id: str, *, last_event_id: str | None = None
    ): ...
    async def get_interaction(self, interaction_id: str): ...


OnEvent = Callable[[str, dict[str, Any]], Awaitable[None]]
OnHeartbeat = Callable[[], None]
ProductArtifact = tuple[str, dict[str, Any]]


_RAW_INTERACTION_EVENTS = {
    "interaction.start",
    "interaction.status_update",
    "interaction.complete",
    "content.start",
    "content.stop",
    "error",
}


def _nested_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("text", "summary", "content"):
            text = _nested_text(value.get(key))
            if text:
                return text
    return ""


def _interaction_event_to_artifact(kind: str, payload: dict[str, Any]) -> ProductArtifact | None:
    """Map Gemini Interactions stream events to stored product artifacts.

    The Gemini Interactions API streams transport-level events such as
    ``content.delta``. The API/web surface stores product-level artifacts
    (``text_delta``, ``thought_summary``, ``image``, ``citation``). Tests used
    to feed already-normalized events, which hid the missing adapter.
    """
    if kind in {"thought_summary", "text_delta", "image", "citation"}:
        return kind, payload
    if kind == "text":
        return "text_delta", payload
    if kind == "status" or kind in _RAW_INTERACTION_EVENTS:
        return None
    if kind != "content.delta":
        return None

    delta = payload.get("delta")
    if not isinstance(delta, dict):
        return None

    delta_type = delta.get("type")
    if delta_type == "text":
        text = _nested_text(delta)
        return ("text_delta", {"text": text}) if text else None
    if delta_type == "thought_summary":
        text = _nested_text(delta.get("content")) or _nested_text(delta)
        return ("thought_summary", {"text": text}) if text else None
    if delta_type == "image":
        url = delta.get("url") or delta.get("image_url") or delta.get("uri")
        if not isinstance(url, str) or not url:
            return None
        mime_type = (
            delta.get("mime_type") or delta.get("mimeType") or delta.get("mime") or "image/png"
        )
        artifact: dict[str, Any] = {"url": url, "mime_type": str(mime_type)}
        base64_data = delta.get("base64") or delta.get("data")
        if isinstance(base64_data, str) and base64_data:
            artifact["base64"] = base64_data
        return "image", artifact
    if delta_type == "citation":
        url = delta.get("url") or delta.get("source_url") or delta.get("sourceUrl")
        if not isinstance(url, str) or not url:
            return None
        title = delta.get("title") or delta.get("source_title") or ""
        return "citation", {"url": url, "title": str(title)}
    return None


async def _run_execute_research(
    inp: ExecuteResearchInput,
    *,
    provider_factory: Callable[[str], _ProviderLike],
    fetch_byok_ciphertext: Callable[[str], Awaitable[bytes | None]],
    on_event: OnEvent,
    on_heartbeat: OnHeartbeat,
) -> ExecuteResearchOutput:
    try:
        api_key = await resolve_api_key(
            user_id=inp.user_id,
            billing_path=inp.billing_path,  # type: ignore[arg-type]
            fetch_byok_ciphertext=fetch_byok_ciphertext,
        )
    except KeyResolutionError as exc:
        raise ApplicationError(str(exc), type="key_resolution", non_retryable=True) from exc

    provider = provider_factory(api_key)
    handle = await provider.start_interaction(
        input=inp.approved_plan,
        agent=inp.model,
        collaborative_planning=False,
        background=True,
        previous_interaction_id=inp.previous_interaction_id,
        thinking_summaries="auto",
        visualization="auto",
    )

    images: list[dict[str, str]] = []
    citations: list[dict[str, str]] = []
    on_heartbeat()  # initial heartbeat

    stream = await provider.stream_interaction(handle.id)
    async for ev in stream:
        for kind, payload in _normalise_stream_event(ev):
            await on_event(kind, payload)
            if kind == "image":
                images.append(
                    {
                        "url": payload["url"],
                        "mime_type": payload.get("mime_type", "image/png"),
                    }
                )
            elif kind == "citation":
                citations.append(
                    {
                        "url": payload["url"],
                        "title": payload.get("title", ""),
                    }
                )
        on_heartbeat()

    final = await provider.get_interaction(handle.id)
    if final.status != "completed":
        err = final.error or {}
        code = err.get("code", final.status)
        msg = err.get("message", "")
        raise ApplicationError(
            f"execute_research {final.status}: {code}: {msg}",
            type=code,
            non_retryable=code in _NON_RETRYABLE_CODES,
        )
    report_text = "".join(o.get("text", "") for o in final.outputs if o.get("type") == "text")
    return ExecuteResearchOutput(
        interaction_id=handle.id,
        report_text=report_text,
        images=images,
        citations=citations,
    )


def _normalise_stream_event(ev: Any) -> list[tuple[str, dict[str, Any]]]:
    """Map Gemini Interactions stream events to OpenCairn artifact kinds.

    Current Gemini docs stream model output as ``content.delta`` events whose
    typed ``delta`` payload can be text, thought_summary, image, or
    text_annotation. Older tests/fakes used direct OpenCairn kind names; keep
    those accepted so retries and unit seams stay compatible.
    """
    kind = getattr(ev, "kind", "")
    payload = getattr(ev, "payload", {}) or {}

    if kind == "content.delta":
        delta = payload.get("delta") if isinstance(payload, dict) else None
        if isinstance(delta, dict) and delta.get("type") == "text_annotation":
            out: list[tuple[str, dict[str, Any]]] = []
            for annotation in delta.get("annotations") or []:
                if not isinstance(annotation, dict):
                    continue
                url = annotation.get("url") or annotation.get("sourceUrl")
                if not url:
                    continue
                out.append(
                    (
                        "citation",
                        {
                            "url": str(url),
                            "title": str(annotation.get("title") or ""),
                        },
                    )
                )
            return out

    artifact = _interaction_event_to_artifact(kind, payload)
    return [artifact] if artifact is not None else []


def _to_api_payload(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Translate provider snake_case event keys to the API's camelCase schema.

    The Gemini stream emits ``mime_type`` for images and ``url`` for citations,
    but ``researchArtifactWriteSchema`` (apps/api/src/routes/internal.ts) is a
    strict discriminated union expecting ``mimeType`` / ``sourceUrl``. Without
    this mapping every image/citation POST 400s and gets swallowed by the
    ``except`` below — image-bytes lookups then 404 forever (audit S4-008
    follow-up to PR #151).
    """
    if kind == "image" and "mime_type" in payload:
        p = dict(payload)
        p["mimeType"] = p.pop("mime_type")
        return p
    if kind == "citation" and "url" in payload:
        p = dict(payload)
        p["sourceUrl"] = p.pop("url")
        return p
    return payload


async def _default_persist_event(kind: str, payload: dict[str, Any]) -> None:
    """Write a streamed artifact through to the API's internal endpoint.

    Path must include the ``/api`` prefix the Hono router mounts at
    (``app.route("/api/internal", internalRoutes)``); a missing prefix
    silently 404s and the ``except Exception`` below swallows the failure
    so the stream keeps running. Audit S4-008 (2026-04-28) corrected this
    plus added the matching endpoint on the API side.
    """
    from worker.lib.api_client import post_internal

    run_id = activity.info().workflow_id
    try:
        await post_internal(
            f"/api/internal/research/runs/{run_id}/artifacts",
            {"kind": kind, "payload": _to_api_payload(kind, payload)},
        )
    except Exception:  # pragma: no cover — keep the stream resilient
        if activity.in_activity():
            activity.logger.warning("artifact persist failed — see /api/internal/research/runs")


def _default_heartbeat() -> None:
    activity.heartbeat()


@activity.defn(name="execute_deep_research")
async def execute_deep_research(inp: ExecuteResearchInput) -> dict[str, Any]:
    out = await _run_execute_research(
        inp,
        provider_factory=_production_provider_factory(inp.model),
        fetch_byok_ciphertext=_default_fetch_byok,
        on_event=_default_persist_event,
        on_heartbeat=_default_heartbeat,
    )
    return {
        "interaction_id": out.interaction_id,
        "report_text": out.report_text,
        "images": out.images,
        "citations": out.citations,
    }
