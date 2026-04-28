from worker.lib.mcp_secrets import decrypt_mcp_auth_header


def test_decrypt_mcp_auth_header_none_is_none():
    assert decrypt_mcp_auth_header(None, "Authorization") is None
