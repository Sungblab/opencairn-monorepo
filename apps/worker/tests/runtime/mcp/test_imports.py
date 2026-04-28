"""Pin the MCP Python SDK surface used by runtime.mcp."""


def test_mcp_sdk_surface_present():
    from mcp import ClientSession, types
    from mcp.client.streamable_http import streamablehttp_client

    assert ClientSession is not None
    assert streamablehttp_client is not None
    assert hasattr(types, "Tool")
