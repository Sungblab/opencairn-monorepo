from __future__ import annotations

from unittest.mock import patch

import pytest

from runtime.tools import ToolContext
from worker.tools_builtin.fetch_url import fetch_url


def _ctx() -> ToolContext:
    async def _emit(_ev): ...
    return ToolContext(
        workspace_id="ws", project_id="pj", page_id=None,
        user_id="u", run_id="r", scope="project",
        emit=_emit,
    )


@pytest.mark.parametrize("url", [
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://127.0.0.1/",
    "http://localhost/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[fe80::1]/",
])
async def test_fetch_url_blocks_private_address(url):
    res = await fetch_url.run(args={"url": url}, ctx=_ctx())
    assert res.get("error")
    assert "private" in res["error"].lower() or "blocked" in res["error"].lower()


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "gopher://example.com/",
    "ftp://example.com/",
    "javascript:alert(1)",
])
async def test_fetch_url_blocks_unsupported_scheme(url):
    res = await fetch_url.run(args={"url": url}, ctx=_ctx())
    assert res.get("error")


async def test_fetch_url_public_http_returns_content():
    with patch("worker.tools_builtin.fetch_url._resolve_host",
               return_value=["93.184.216.34"]), \
         patch("worker.tools_builtin.fetch_url._fetch_bytes") as mock_fetch:
        async def _f(url):
            return (
                b"<html><body><p>Hello world</p></body></html>",
                "text/html",
            )
        mock_fetch.side_effect = _f
        res = await fetch_url.run(
            args={"url": "https://example.com/"},
            ctx=_ctx(),
        )
        assert "Hello world" in res["content"]
        assert res["content_type"] == "text/html"


async def test_fetch_url_binary_content_omitted():
    with patch("worker.tools_builtin.fetch_url._resolve_host",
               return_value=["93.184.216.34"]), \
         patch("worker.tools_builtin.fetch_url._fetch_bytes") as mock_fetch:
        async def _f(url):
            return (b"\x00\x01\x02", "application/pdf")
        mock_fetch.side_effect = _f
        res = await fetch_url.run(
            args={"url": "https://example.com/file.pdf"},
            ctx=_ctx(),
        )
        assert "[binary content omitted]" in res["content"]
