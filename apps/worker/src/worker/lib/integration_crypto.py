"""AES-256-GCM encrypt/decrypt wire-compatible with
apps/api/src/lib/integration-tokens.ts.

Wire layout: iv(12 bytes) || tag(16 bytes) || ciphertext.

The `cryptography` library emits ct||tag and consumes ct||tag, so we
re-shuffle to keep a single format on disk. Both sides read/write
user_integrations.access_token_encrypted.
"""
from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_IV_LEN = 12
_TAG_LEN = 16


def _get_key() -> bytes:
    raw = os.environ.get("INTEGRATION_TOKEN_ENCRYPTION_KEY")
    if not raw:
        raise RuntimeError(
            "INTEGRATION_TOKEN_ENCRYPTION_KEY is not set. "
            "Generate a 32-byte base64 key and set it in the environment."
        )
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise RuntimeError(
            f"INTEGRATION_TOKEN_ENCRYPTION_KEY must decode to 32 bytes "
            f"(got {len(key)})"
        )
    return key


def encrypt_token(plaintext: str) -> bytes:
    key = _get_key()
    iv = os.urandom(_IV_LEN)
    aesgcm = AESGCM(key)
    ct_with_tag = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    ct = ct_with_tag[:-_TAG_LEN]
    tag = ct_with_tag[-_TAG_LEN:]
    return iv + tag + ct


def decrypt_token(blob: bytes) -> str:
    key = _get_key()
    iv = blob[:_IV_LEN]
    tag = blob[_IV_LEN : _IV_LEN + _TAG_LEN]
    ct = blob[_IV_LEN + _TAG_LEN :]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(iv, ct + tag, None).decode("utf-8")
