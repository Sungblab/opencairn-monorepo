"""Key resolver — translates (user_id, billing_path) into a plaintext
Gemini API key. BYOK: decrypt user_preferences.byok_api_key_encrypted.
Managed: read GEMINI_MANAGED_API_KEY env.

Tests inject a fake fetcher so we don't need a live DB.
"""
from __future__ import annotations

import asyncio
import base64

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from worker.activities.deep_research.keys import (
    KeyResolutionError,
    resolve_api_key,
)
from worker.lib.integration_crypto import encrypt_token


@pytest.fixture
def _encryption_key(monkeypatch):
    raw = AESGCM.generate_key(bit_length=256)
    monkeypatch.setenv(
        "INTEGRATION_TOKEN_ENCRYPTION_KEY", base64.b64encode(raw).decode()
    )


def test_byok_decrypts_user_preferences_key(_encryption_key):
    ciphertext = encrypt_token("gemini-secret-123")

    async def _fetch_byok(user_id: str) -> bytes | None:
        assert user_id == "user-abc"
        return ciphertext

    result = asyncio.run(
        resolve_api_key(
            user_id="user-abc",
            billing_path="byok",
            fetch_byok_ciphertext=_fetch_byok,
        )
    )
    assert result == "gemini-secret-123"


def test_byok_missing_raises(_encryption_key):
    async def _fetch_byok(_: str) -> bytes | None:
        return None

    with pytest.raises(KeyResolutionError, match="no byok key"):
        asyncio.run(
            resolve_api_key(
                user_id="user-abc",
                billing_path="byok",
                fetch_byok_ciphertext=_fetch_byok,
            )
        )


def test_managed_reads_env(monkeypatch):
    monkeypatch.setenv("GEMINI_MANAGED_API_KEY", "server-secret-xyz")

    async def _fetch_byok(_: str) -> bytes | None:
        raise AssertionError("must not call byok fetcher on managed path")

    result = asyncio.run(
        resolve_api_key(
            user_id="user-abc",
            billing_path="managed",
            fetch_byok_ciphertext=_fetch_byok,
        )
    )
    assert result == "server-secret-xyz"


def test_managed_missing_env_raises(monkeypatch):
    monkeypatch.delenv("GEMINI_MANAGED_API_KEY", raising=False)

    async def _fetch_byok(_: str) -> bytes | None:
        return None

    with pytest.raises(KeyResolutionError, match="GEMINI_MANAGED_API_KEY"):
        asyncio.run(
            resolve_api_key(
                user_id="user-abc",
                billing_path="managed",
                fetch_byok_ciphertext=_fetch_byok,
            )
        )
