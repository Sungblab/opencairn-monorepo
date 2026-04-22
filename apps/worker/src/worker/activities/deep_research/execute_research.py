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

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol

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
        raise ApplicationError(
            str(exc), type="key_resolution", non_retryable=True
        ) from exc

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
        if ev.kind == "status":
            # Status is advisory only — authoritative final status comes
            # from get_interaction after the stream closes.
            continue
        await on_event(ev.kind, ev.payload)
        if ev.kind == "image":
            images.append(
                {
                    "url": ev.payload["url"],
                    "mime_type": ev.payload.get("mime_type", "image/png"),
                }
            )
        elif ev.kind == "citation":
            citations.append(
                {
                    "url": ev.payload["url"],
                    "title": ev.payload.get("title", ""),
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
    report_text = "".join(
        o.get("text", "") for o in final.outputs if o.get("type") == "text"
    )
    return ExecuteResearchOutput(
        interaction_id=handle.id,
        report_text=report_text,
        images=images,
        citations=citations,
    )


async def _default_persist_event(kind: str, payload: dict[str, Any]) -> None:
    """Write a streamed artifact through to the API's internal endpoint.

    The endpoint itself ships in Phase C. Until then the POST 404s and
    we swallow it so the stream keeps running during pre-Phase-C smoke
    tests. The raw payload is also already in Temporal's activity log,
    so no data loss even if the persist fails silently.
    """
    from worker.lib.api_client import post_internal

    run_id = activity.info().workflow_id
    try:
        await post_internal(
            f"/internal/research/{run_id}/artifacts",
            {"kind": kind, "payload": payload},
        )
    except Exception:  # pragma: no cover — Phase B tolerates missing endpoint
        if activity.in_activity():
            activity.logger.warning(
                "artifact persist failed — endpoint likely missing (Phase C)"
            )


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
