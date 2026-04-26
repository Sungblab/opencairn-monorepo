"""Resolve LLM provider per billing-routing.md.

Phase 2 reuses the env-default chat policy. BYOK / managed credit routing
is a Plan 9b follow-up — the kwargs are accepted but ignored for now.
"""
from __future__ import annotations

from typing import Literal, Optional

from llm import LLMProvider, get_provider


async def resolve_llm_provider(
    *,
    user_id: str,
    workspace_id: str,
    purpose: Literal["chat", "embedding", "research"],
    byok_key_handle: Optional[str],
) -> LLMProvider:
    # TODO(Plan 9b): route BYOK > credits > Admin per
    # docs/architecture/billing-routing.md. For now: env-based default
    # (chat policy).
    del user_id, workspace_id, purpose, byok_key_handle  # unused for now
    return get_provider()
