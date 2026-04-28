from __future__ import annotations

from worker.lib.integration_crypto import decrypt_token


def decrypt_mcp_auth_header(
    encrypted: bytes | None,
    header_name: str,
) -> tuple[str, str] | None:
    if encrypted is None:
        return None
    return (header_name or "Authorization", decrypt_token(bytes(encrypted)))
