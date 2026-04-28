from __future__ import annotations

import pytest

from worker.lib import s3_client


def _reset_client() -> None:
    s3_client._client = None


def test_get_s3_client_requires_explicit_access_key(monkeypatch):
    _reset_client()
    monkeypatch.delenv("S3_ACCESS_KEY", raising=False)
    monkeypatch.setenv("S3_SECRET_KEY", "dev-secret")

    with pytest.raises(RuntimeError, match="S3_ACCESS_KEY"):
        s3_client.get_s3_client()


def test_get_s3_client_requires_explicit_secret_key(monkeypatch):
    _reset_client()
    monkeypatch.setenv("S3_ACCESS_KEY", "dev-access")
    monkeypatch.delenv("S3_SECRET_KEY", raising=False)

    with pytest.raises(RuntimeError, match="S3_SECRET_KEY"):
        s3_client.get_s3_client()


def test_get_s3_client_uses_explicit_credentials(monkeypatch):
    _reset_client()
    created: dict[str, object] = {}

    class FakeMinio:
        def __init__(self, endpoint, *, access_key, secret_key, secure):
            created.update(
                endpoint=endpoint,
                access_key=access_key,
                secret_key=secret_key,
                secure=secure,
            )

    monkeypatch.setattr(s3_client, "Minio", FakeMinio)
    monkeypatch.setenv("S3_ENDPOINT", "https://minio.example.com:9443")
    monkeypatch.setenv("S3_ACCESS_KEY", "dev-access")
    monkeypatch.setenv("S3_SECRET_KEY", "dev-secret")
    monkeypatch.setenv("S3_USE_SSL", "false")

    s3_client.get_s3_client()

    assert created == {
        "endpoint": "minio.example.com:9443",
        "access_key": "dev-access",
        "secret_key": "dev-secret",
        "secure": True,
    }
