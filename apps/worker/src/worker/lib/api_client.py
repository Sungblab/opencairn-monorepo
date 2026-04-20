"""Internal API client — worker → Hono callback helper.

The worker closes the ingest loop by POSTing extracted text back to the Hono
API (see ``apps/api/src/routes/internal.ts``), which persists the source note
under the caller's project. Authentication is a shared secret
(``INTERNAL_API_SECRET``) carried in the ``X-Internal-Secret`` header; this
header must never leave the internal docker network.
"""
from __future__ import annotations

import os

import httpx

API_BASE = os.environ.get("INTERNAL_API_URL", "http://api:4000")
INTERNAL_SECRET = os.environ.get("INTERNAL_API_SECRET", "change-me-in-production")


async def post_internal(path: str, body: dict) -> dict:
    """POST ``body`` as JSON to ``{API_BASE}{path}`` with the internal secret.

    Raises for non-2xx. Returns the decoded JSON body on success. 30s timeout
    matches the longest source-note insert we expect (large text + embedding
    trigger queueing).
    """
    async with httpx.AsyncClient(base_url=API_BASE, timeout=30.0) as client:
        response = await client.post(
            path,
            json=body,
            headers={"X-Internal-Secret": INTERNAL_SECRET},
        )
        response.raise_for_status()
        return response.json()
