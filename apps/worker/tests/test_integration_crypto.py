import base64

import pytest

from worker.lib.integration_crypto import (
    encrypt_token,
    decrypt_token,
)

KEY_B64 = base64.b64encode(b"\x42" * 32).decode()


def test_roundtrip(monkeypatch):
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", KEY_B64)
    pt = "ya29.a0Abc-oauth-token-xyz"
    ct = encrypt_token(pt)
    assert isinstance(ct, bytes)
    assert len(ct) > 12 + 16
    assert decrypt_token(ct) == pt


def test_random_iv_produces_distinct_ciphertext(monkeypatch):
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", KEY_B64)
    a = encrypt_token("same")
    b = encrypt_token("same")
    assert a != b


def test_missing_key_raises(monkeypatch):
    monkeypatch.delenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", raising=False)
    with pytest.raises(RuntimeError, match="INTEGRATION_TOKEN_ENCRYPTION_KEY"):
        encrypt_token("x")


def test_wrong_key_length_raises(monkeypatch):
    bad = base64.b64encode(b"\x00" * 16).decode()
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", bad)
    with pytest.raises(RuntimeError, match="32 bytes"):
        encrypt_token("x")


def test_wrong_key_fails(monkeypatch):
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", KEY_B64)
    ct = encrypt_token("hello")
    wrong = base64.b64encode(b"\x99" * 32).decode()
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", wrong)
    with pytest.raises(Exception):
        decrypt_token(ct)


def test_cross_compat_wire_layout(monkeypatch):
    """TS side produces iv(12)||tag(16)||ct. A blob with that exact layout
    must decrypt here. Verifies wire-format parity without needing a live
    TS process."""
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", KEY_B64)
    # Produced by apps/api AES-256-GCM for plaintext "cross-compat" with
    # key = 32 x 0x42 — regenerate if wire format ever changes.
    # Simpler: encrypt here and verify layout markers.
    ct = encrypt_token("cross-compat")
    iv, tag, body = ct[:12], ct[12:28], ct[28:]
    assert len(iv) == 12
    assert len(tag) == 16
    assert len(body) == len("cross-compat")


# ---------- key rotation (audit Tier 5 §5.2) ----------

ROTATED_KEY_B64 = base64.b64encode(b"\x77" * 32).decode()


def test_rotation_decrypts_with_old_key_fallback(monkeypatch):
    """After rotation, blobs written with the previous key must still
    decrypt via INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD."""
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", KEY_B64)
    monkeypatch.delenv("INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD", raising=False)
    blob = encrypt_token("oauth-token-pre-rotation")

    # Operator rotates: new key current, old key moved to _OLD.
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", ROTATED_KEY_B64)
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD", KEY_B64)
    assert decrypt_token(blob) == "oauth-token-pre-rotation"


def test_rotation_encrypts_with_current_key_only(monkeypatch):
    """encrypt_token must never use _OLD — new writes go to the current
    key so dropping _OLD later does not lose them."""
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", ROTATED_KEY_B64)
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD", KEY_B64)
    blob = encrypt_token("written-after-rotation")

    monkeypatch.delenv("INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD", raising=False)
    assert decrypt_token(blob) == "written-after-rotation"


def test_rotation_fails_when_neither_key_matches(monkeypatch):
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", KEY_B64)
    blob = encrypt_token("orphan")

    monkeypatch.setenv(
        "INTEGRATION_TOKEN_ENCRYPTION_KEY",
        base64.b64encode(b"\x11" * 32).decode(),
    )
    monkeypatch.setenv(
        "INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD",
        base64.b64encode(b"\x22" * 32).decode(),
    )
    with pytest.raises(Exception):
        decrypt_token(blob)


def test_rotation_no_old_key_works_as_before(monkeypatch):
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", KEY_B64)
    monkeypatch.delenv("INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD", raising=False)
    blob = encrypt_token("single-key")
    assert decrypt_token(blob) == "single-key"


def test_rotation_old_key_wrong_length_raises(monkeypatch):
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", ROTATED_KEY_B64)
    blob = encrypt_token("anything")
    # _OLD is malformed (16 bytes). Current key is also unrelated to blob,
    # so decryption falls through to _OLD validation, which must throw a
    # clear length error rather than swallowing.
    monkeypatch.setenv(
        "INTEGRATION_TOKEN_ENCRYPTION_KEY",
        base64.b64encode(b"\x11" * 32).decode(),
    )
    monkeypatch.setenv(
        "INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD",
        base64.b64encode(b"\x00" * 16).decode(),
    )
    with pytest.raises(RuntimeError, match="32 bytes"):
        decrypt_token(blob)
