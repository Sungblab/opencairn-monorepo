"""``iterate_deep_research_plan`` Temporal activity.

Same poll loop as ``create_plan`` but with a chained
``previous_interaction_id`` so Google iterates on the prior plan instead
of starting a new one. Kept as a separate activity — not a flag on
``create_plan`` — so workflow history is easier to read and each
activity has one retry policy to reason about.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from temporalio import activity
from temporalio.exceptions import ApplicationError

from worker.activities.deep_research.create_plan import (
    _default_fetch_byok,
    _extract_text,
    _production_provider_factory,
)
from worker.activities.deep_research.keys import (
    KeyResolutionError,
    resolve_api_key,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable


@dataclass
class IteratePlanInput:
    run_id: str
    user_id: str
    feedback: str
    model: str
    billing_path: str
    previous_interaction_id: str


@dataclass
class IteratePlanOutput:
    interaction_id: str
    plan_text: str


class _ProviderLike(Protocol):
    async def start_interaction(self, **kwargs): ...
    async def get_interaction(self, interaction_id: str): ...


async def _run_iterate_plan(
    inp: IteratePlanInput,
    *,
    provider_factory: Callable[[str], _ProviderLike],
    fetch_byok_ciphertext: Callable[[str], Awaitable[bytes | None]],
    poll_interval_seconds: float = 5.0,
) -> IteratePlanOutput:
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
        input=inp.feedback,
        agent=inp.model,
        collaborative_planning=True,
        background=True,
        previous_interaction_id=inp.previous_interaction_id,
    )

    state = None
    while True:
        state = await provider.get_interaction(handle.id)
        if state.status == "completed":
            break
        if state.status in ("failed", "cancelled"):
            err = state.error or {}
            raise ApplicationError(
                f"interaction {state.status}: {err.get('code', 'unknown')}",
                type=err.get("code", state.status),
                non_retryable=True,
            )
        await asyncio.sleep(poll_interval_seconds)

    text = _extract_text(state.outputs)
    if not text:
        raise ApplicationError(
            "empty iterated plan", type="empty_plan", non_retryable=True
        )
    return IteratePlanOutput(interaction_id=handle.id, plan_text=text)


@activity.defn(name="iterate_deep_research_plan")
async def iterate_deep_research_plan(inp: IteratePlanInput) -> dict[str, str]:
    out = await _run_iterate_plan(
        inp,
        provider_factory=_production_provider_factory(inp.model),
        fetch_byok_ciphertext=_default_fetch_byok,
    )
    return {"interaction_id": out.interaction_id, "plan_text": out.plan_text}
