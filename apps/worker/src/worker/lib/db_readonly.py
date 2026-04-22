"""Read-only DB helpers for Temporal activities.

Kept minimal — activities prefer HTTP to ``/api/internal`` for writes but
need a couple of direct reads (BYOK ciphertext, run projection) where a
round-trip to the API would be wasteful. Uses asyncpg to match the rest
of the worker (see apps/worker/pyproject.toml).
"""
from __future__ import annotations

import os

import asyncpg


def _asyncpg_url(url: str) -> str:
    # asyncpg doesn't accept the `postgresql+driver` scheme variants.
    # Strip any dialect suffix SQLAlchemy-style URLs may carry.
    if url.startswith("postgresql+"):
        return "postgresql://" + url.split("://", 1)[1]
    return url


async def fetch_byok_ciphertext(user_id: str) -> bytes | None:
    """Return the AES-256-GCM blob from user_preferences.byok_api_key_encrypted,
    or ``None`` if the user has no key registered."""
    url = _asyncpg_url(os.environ["DATABASE_URL"])
    conn = await asyncpg.connect(url)
    try:
        row = await conn.fetchrow(
            "SELECT byok_api_key_encrypted FROM user_preferences WHERE user_id = $1",
            user_id,
        )
    finally:
        await conn.close()
    if row is None or row["byok_api_key_encrypted"] is None:
        return None
    return bytes(row["byok_api_key_encrypted"])
