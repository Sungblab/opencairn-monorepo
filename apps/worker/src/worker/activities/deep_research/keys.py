"""Gemini API key resolver for Deep Research activities.

The resolver is called **inside** each activity — never from the workflow —
so plaintext keys never enter Temporal event history. The fetcher callback
exists so tests can inject fake DB behaviour; production callers use the
default ``fetch_byok_ciphertext_from_db`` wired up in db_readonly.
"""
from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from typing import Literal

from worker.lib.integration_crypto import decrypt_token

BillingPath = Literal["byok", "managed"]
ByokFetcher = Callable[[str], Awaitable[bytes | None]]


class KeyResolutionError(RuntimeError):
    """Non-retryable key acquisition failure. Worker should fail-fast."""


async def resolve_api_key(
    *,
    user_id: str,
    billing_path: BillingPath,
    fetch_byok_ciphertext: ByokFetcher,
) -> str:
    if billing_path == "managed":
        key = os.environ.get("GEMINI_MANAGED_API_KEY", "").strip()
        if not key:
            raise KeyResolutionError(
                "billing_path=managed but GEMINI_MANAGED_API_KEY is not set"
            )
        return key

    if billing_path == "byok":
        ciphertext = await fetch_byok_ciphertext(user_id)
        if ciphertext is None:
            raise KeyResolutionError(
                f"no byok key registered for user {user_id}"
            )
        return decrypt_token(ciphertext)

    raise KeyResolutionError(f"unknown billing_path: {billing_path}")
