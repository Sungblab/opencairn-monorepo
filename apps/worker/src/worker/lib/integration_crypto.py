"""AES-256-GCM encrypt/decrypt wire-compatible with
apps/api/src/lib/integration-tokens.ts.

Wire layout: iv(12 bytes) || tag(16 bytes) || ciphertext.

The `cryptography` library emits ct||tag and consumes ct||tag, so we
re-shuffle to keep a single format on disk. Both sides read/write
user_integrations.access_token_encrypted.

Key rotation (audit Tier 5 §5.2): when the operator rotates
INTEGRATION_TOKEN_ENCRYPTION_KEY, they copy the previous value into
INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD. decrypt_token tries the current key
first, then falls back to _OLD; encrypt_token always writes with the
current key only, so dropping _OLD after every blob has been migrated
does not lose data. See docs/contributing/byok-key-rotation.md.
"""
from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_IV_LEN = 12
_TAG_LEN = 16


def _decode_key(raw: str, env_name: str) -> bytes:
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise RuntimeError(
            f"{env_name} must decode to 32 bytes (got {len(key)})"
        )
    return key


def _get_current_key() -> bytes:
    raw = os.environ.get("INTEGRATION_TOKEN_ENCRYPTION_KEY")
    if not raw:
        raise RuntimeError(
            "INTEGRATION_TOKEN_ENCRYPTION_KEY is not set. "
            "Generate a 32-byte base64 key and set it in the environment."
        )
    return _decode_key(raw, "INTEGRATION_TOKEN_ENCRYPTION_KEY")


def _get_old_key() -> bytes | None:
    raw = os.environ.get("INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD")
    if not raw:
        return None
    return _decode_key(raw, "INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD")


def encrypt_token(plaintext: str) -> bytes:
    key = _get_current_key()
    iv = os.urandom(_IV_LEN)
    aesgcm = AESGCM(key)
    ct_with_tag = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    ct = ct_with_tag[:-_TAG_LEN]
    tag = ct_with_tag[-_TAG_LEN:]
    return iv + tag + ct


def decrypt_token(blob: bytes) -> str:
    iv = blob[:_IV_LEN]
    tag = blob[_IV_LEN : _IV_LEN + _TAG_LEN]
    ct = blob[_IV_LEN + _TAG_LEN :]

    current_key = _get_current_key()
    try:
        return AESGCM(current_key).decrypt(iv, ct + tag, None).decode("utf-8")
    except Exception as current_err:
        # _get_old_key() raises RuntimeError on malformed _OLD env — that's
        # operator misconfig and must surface, not be swallowed as a routine
        # "wrong key" GCM auth failure.
        old_key = _get_old_key()
        if old_key is None:
            raise current_err
        return AESGCM(old_key).decrypt(iv, ct + tag, None).decode("utf-8")
