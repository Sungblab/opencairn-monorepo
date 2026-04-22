"""``create_deep_research_plan`` Temporal activity.

First turn of a Deep Research run. Calls
``GeminiProvider.start_interaction(collaborative_planning=True, background=True)``
and polls ``get_interaction`` until the plan proposal is ready.

Side effects (DB writes, SSE fan-out) live in the workflow after this
activity returns — that keeps the activity testable without a DB and
lets the workflow hold the authoritative projection.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Protocol

from temporalio import activity
from temporalio.exceptions import ApplicationError

from llm.base import ProviderConfig
from llm.factory import get_provider

from worker.activities.deep_research.keys import (
    KeyResolutionError,
    resolve_api_key,
)


@dataclass
class CreatePlanInput:
    run_id: str
    user_id: str
    topic: str
    model: str
    billing_path: str


@dataclass
class CreatePlanOutput:
    interaction_id: str
    plan_text: str


class _ProviderLike(Protocol):
    async def start_interaction(self, **kwargs): ...
    async def get_interaction(self, interaction_id: str): ...


ProviderFactory = Callable[[str], _ProviderLike]
ByokFetcher = Callable[[str], Awaitable[bytes | None]]


async def _run_create_plan(
    inp: CreatePlanInput,
    *,
    provider_factory: ProviderFactory,
    fetch_byok_ciphertext: ByokFetcher,
    poll_interval_seconds: float = 5.0,
) -> CreatePlanOutput:
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
        input=inp.topic,
        agent=inp.model,
        collaborative_planning=True,
        background=True,
    )

    state = None
    while True:
        state = await provider.get_interaction(handle.id)
        if state.status == "completed":
            break
        if state.status in ("failed", "cancelled"):
            err = state.error or {}
            raise ApplicationError(
                f"interaction {state.status}: {err.get('code', 'unknown')}: {err.get('message', '')}",
                type=err.get("code", state.status),
                non_retryable=True,
            )
        await asyncio.sleep(poll_interval_seconds)

    plan_text = _extract_text(state.outputs)
    if not plan_text:
        raise ApplicationError(
            "interaction completed without text output",
            type="empty_plan",
            non_retryable=True,
        )
    return CreatePlanOutput(interaction_id=handle.id, plan_text=plan_text)


def _extract_text(outputs: list[dict[str, Any]]) -> str:
    return "".join(o.get("text", "") for o in outputs if o.get("type") == "text")


async def _default_fetch_byok(user_id: str) -> bytes | None:
    # Lazy import so unit tests never drag in asyncpg.
    from worker.lib.db_readonly import fetch_byok_ciphertext as _fetch

    return await _fetch(user_id)


def _production_provider_factory(model: str) -> Callable[[str], _ProviderLike]:
    """Build a factory that returns a GeminiProvider bound to the given API key.

    Model id is captured in ``ProviderConfig.model`` so the provider's
    ``start_interaction`` call can default to it, but the activity passes
    ``agent=<model>`` explicitly anyway.
    """

    def _factory(api_key: str) -> _ProviderLike:
        config = ProviderConfig(
            provider="gemini",
            api_key=api_key,
            model=model,
            embed_model="gemini-embedding-001",
        )
        return get_provider(config)

    return _factory


@activity.defn(name="create_deep_research_plan")
async def create_deep_research_plan(inp: CreatePlanInput) -> dict[str, str]:
    """Return a dict so the workflow doesn't need the dataclass type
    registered for Temporal serialization (matches ``batch_embed_activities``)."""
    out = await _run_create_plan(
        inp,
        provider_factory=_production_provider_factory(inp.model),
        fetch_byok_ciphertext=_default_fetch_byok,
    )
    return {"interaction_id": out.interaction_id, "plan_text": out.plan_text}
