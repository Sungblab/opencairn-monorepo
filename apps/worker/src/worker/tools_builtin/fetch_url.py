"""`fetch_url` tool — public URL fetch with SSRF defenses.

Blocks RFC1918 private ranges, loopback, link-local (AWS metadata
included), IPv6 link-local, and non-http(s) schemes. DNS resolution is
performed up-front so a domain that resolves to a private IP is rejected
before bytes are pulled (naive rebinding defense — sufficient for a
worker where ingress is controlled).
"""
from __future__ import annotations

import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx

from runtime.tools import ToolContext, tool

MAX_BYTES = 10 * 1024 * 1024  # 10 MB
TIMEOUT_SEC = 60.0


def _is_private(ip_str: str) -> bool:
    """True if `ip_str` is a literal IP in a private/internal range.

    Returns False for hostnames (non-IP strings) — the caller runs DNS
    resolution separately and re-checks each resolved address, so letting
    hostnames through here is safe.
    """
    # Strip IPv6 literal brackets so `[fe80::1]` parses.
    clean = ip_str.strip("[]")
    try:
        ip = ipaddress.ip_address(clean)
    except ValueError:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _resolve_host(host: str) -> list[str]:
    # Strip IPv6 literal brackets before resolution.
    clean = host.strip("[]")
    try:
        return [info[4][0] for info in socket.getaddrinfo(clean, None)]
    except socket.gaierror:
        return []


async def _fetch_bytes(url: str) -> tuple[bytes, str]:
    """Isolated for ease of mocking in tests."""
    async with (
        httpx.AsyncClient(timeout=TIMEOUT_SEC, follow_redirects=True) as c,
        c.stream("GET", url) as response,
    ):
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        chunks: list[bytes] = []
        total = 0
        async for chunk in response.aiter_bytes():
            total += len(chunk)
            if total > MAX_BYTES:
                raise ValueError(f"Response exceeded {MAX_BYTES} bytes")
            chunks.append(chunk)
    return b"".join(chunks), content_type.split(";")[0].strip()


class _HtmlTextExtractor(HTMLParser):
    """Tokeniser-based stripper. Regex-based `<script.*?</script>` filtering
    (CodeQL py/bad-tag-filter) is fooled by case/whitespace tricks like
    `<scrIPT >`, self-closing `<script />`, or unclosed tags — but it's also
    just the wrong tool: the stdlib parser tokenises consistently with how a
    browser would handle the same input.
    """

    _SKIP_TAGS = frozenset({"script", "style", "noscript", "template"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in self._SKIP_TAGS:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in self._SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._parts.append(data)

    def text(self) -> str:
        return " ".join(self._parts)


def _extract_text(body: bytes, content_type: str) -> str:
    if not content_type.startswith("text/"):
        return "[binary content omitted]"
    try:
        html = body.decode("utf-8", errors="replace")
    except Exception:
        return "[decoding failed]"
    if content_type == "text/html":
        parser = _HtmlTextExtractor()
        try:
            parser.feed(html)
            parser.close()
        except Exception:
            # Malformed HTML — fall back to whatever the parser collected
            # before bailing rather than dropping the response.
            pass
        return re.sub(r"\s+", " ", parser.text()).strip()
    return html


@tool(name="fetch_url")
async def fetch_url(url: str, ctx: ToolContext) -> dict:
    """Fetch text content from a public URL. Returns an error for
    private/internal addresses, non-http(s) schemes, or responses
    larger than 10 MB."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return {"error": f"Unsupported scheme: {parsed.scheme!r}"}
    host = parsed.hostname or ""
    if not host:
        return {"error": "URL has no host"}

    # Quick-path: literal IP in URL.
    if _is_private(host):
        return {"error": f"Blocked: {host} is a private/internal address"}

    # Resolve hostname and reject if any address is private (rebinding defense).
    addrs = _resolve_host(host)
    if not addrs:
        return {"error": f"DNS resolution failed for {host}"}
    for addr in addrs:
        if _is_private(addr):
            return {
                "error": (
                    f"Blocked: {host} resolves to private address {addr}"
                )
            }

    try:
        body, content_type = await _fetch_bytes(url)
    except ValueError as e:
        return {"error": str(e)}
    except httpx.HTTPError as e:
        return {"error": f"HTTP error: {e}"}

    return {
        "url": url,
        "content": _extract_text(body, content_type),
        "content_type": content_type,
    }
