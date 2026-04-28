"""S3-089 — INTERNAL_API_SECRET fail-fast on call.

The worker's api_client must refuse to send any request if INTERNAL_API_SECRET
is unset. Failing loudly prevents non-Compose deploys (bare Docker, k8s, local)
from silently authenticating to the internal API with a known default string.
The check fires when post/get/patch is actually called, so module import stays
free for tests that mock those functions.
"""
from __future__ import annotations

import pytest

from worker.lib import api_client


@pytest.mark.asyncio
async def test_post_internal_requires_secret_env(monkeypatch):
    monkeypatch.delenv("INTERNAL_API_SECRET", raising=False)

    with pytest.raises(RuntimeError, match="INTERNAL_API_SECRET"):
        await api_client.post_internal("/api/internal/notes", {})


@pytest.mark.asyncio
async def test_post_internal_rejects_blank_secret(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_SECRET", "   ")

    with pytest.raises(RuntimeError, match="INTERNAL_API_SECRET"):
        await api_client.post_internal("/api/internal/notes", {})


@pytest.mark.asyncio
async def test_post_internal_rejects_known_default_placeholder(monkeypatch):
    """The historical default string must never be honored as a real secret."""
    monkeypatch.setenv("INTERNAL_API_SECRET", "change-me-in-production")

    with pytest.raises(RuntimeError, match="INTERNAL_API_SECRET"):
        await api_client.post_internal("/api/internal/notes", {})


@pytest.mark.asyncio
async def test_get_internal_requires_secret_env(monkeypatch):
    monkeypatch.delenv("INTERNAL_API_SECRET", raising=False)

    with pytest.raises(RuntimeError, match="INTERNAL_API_SECRET"):
        await api_client.get_internal("/api/internal/notes/abc")


@pytest.mark.asyncio
async def test_patch_internal_requires_secret_env(monkeypatch):
    monkeypatch.delenv("INTERNAL_API_SECRET", raising=False)

    with pytest.raises(RuntimeError, match="INTERNAL_API_SECRET"):
        await api_client.patch_internal("/api/internal/notes/abc", {})


@pytest.mark.asyncio
async def test_post_internal_sends_x_internal_secret_header(monkeypatch):
    """When the env is set the header must carry the exact secret value."""
    monkeypatch.setenv("INTERNAL_API_SECRET", "real-secret-token-XYZ")

    captured: dict[str, object] = {}

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"ok": True}

    class _FakeClient:
        def __init__(self, *, base_url, timeout):
            captured["base_url"] = base_url
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, path, *, json, headers):
            captured["path"] = path
            captured["json"] = json
            captured["headers"] = headers
            return _FakeResponse()

    monkeypatch.setattr(api_client.httpx, "AsyncClient", _FakeClient)

    result = await api_client.post_internal("/api/internal/notes", {"id": 1})

    assert result == {"ok": True}
    assert captured["headers"] == {"X-Internal-Secret": "real-secret-token-XYZ"}
