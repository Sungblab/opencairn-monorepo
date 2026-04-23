"""Web URL scraping activity with SSRF and response-size defenses.

Tier 0 item 0-2 (Plan 3 C-1) hardened this activity: the old implementation
handed arbitrary URLs to ``httpx.AsyncClient(follow_redirects=True)`` with no
IP filtering and no response cap, making every RFC1918 host and every cloud
IMDS endpoint reachable from any web-ingest task.

Defenses layered here (mirrors the ``fetch_url`` tool):

* Scheme allowlist (``http`` / ``https`` only).
* Literal IP check for host, plus DNS resolution + per-address re-check for
  hostnames (naive DNS-rebinding defense).
* ``follow_redirects=False`` with a manual redirect loop (max 5 hops); every
  hop re-resolves and re-validates the target.
* Streamed response with a 10 MB cap, so a hostile page cannot pin a worker
  slot with a multi-gigabyte payload.
* All policy violations raise ``ApplicationError(non_retryable=True)`` —
  retrying an SSRF attempt has no upside and wastes Temporal schedule slots.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlparse

import httpx
import trafilatura
from temporalio import activity
from temporalio.exceptions import ApplicationError

COMPLEX_MARKER_PATTERN = re.compile(
    r"(figure\s+\d+|table\s+\d+|equation\s+\d+|\$\$|\\\[)",
    re.IGNORECASE,
)
COMPLEX_THRESHOLD = 3
HTTP_TIMEOUT = 30.0
USER_AGENT = "OpenCairn/1.0 (knowledge base ingest bot)"
MAX_BYTES = 10 * 1024 * 1024  # 10 MB hard cap per fetch.
MAX_REDIRECTS = 5


def _extract(html: str) -> str:
    """Trafilatura extraction, fallback to naive strip."""
    text = trafilatura.extract(
        html,
        include_tables=True,
        include_links=False,
        include_images=False,
        output_format="txt",
    )
    if text:
        return text
    stripped = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", stripped).strip()


def _is_private(ip_str: str) -> bool:
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


def _resolve_host_sync(host: str) -> list[str]:
    clean = host.strip("[]")
    try:
        return [info[4][0] for info in socket.getaddrinfo(clean, None)]
    except socket.gaierror:
        return []


async def _resolve_host(host: str) -> list[str]:
    """DNS lookup via thread pool.

    ``socket.getaddrinfo`` is a blocking syscall; calling it inline on an
    asyncio worker would freeze the event loop for the full resolution time
    (seconds under packet loss / timeouts). We bounce through
    ``asyncio.to_thread`` so the event loop stays responsive.
    """
    return await asyncio.to_thread(_resolve_host_sync, host)


async def _assert_url_is_public(url: str) -> None:
    """Raise ``ApplicationError(non_retryable=True)`` if ``url`` targets a
    private or otherwise unsafe destination. Checks scheme, literal IP,
    and DNS resolution for hostnames.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ApplicationError(
            f"Unsupported scheme: {parsed.scheme!r}",
            type="ssrf_blocked",
            non_retryable=True,
        )
    host = parsed.hostname or ""
    if not host:
        raise ApplicationError(
            "URL has no host",
            type="ssrf_blocked",
            non_retryable=True,
        )
    # Hostnames that are already bracketed IPv6 or bare IPv4 literals.
    if _is_private(host):
        raise ApplicationError(
            f"Blocked: {host} is a private/internal address",
            type="ssrf_blocked",
            non_retryable=True,
        )
    addrs = await _resolve_host(host)
    if not addrs:
        raise ApplicationError(
            f"DNS resolution failed for {host}",
            type="ssrf_blocked",
            non_retryable=True,
        )
    for addr in addrs:
        if _is_private(addr):
            raise ApplicationError(
                f"Blocked: {host} resolves to private address {addr}",
                type="ssrf_blocked",
                non_retryable=True,
            )


async def _scrape_impl(url: str) -> dict:
    """Core SSRF-safe scraping. Pure async function — no Temporal activity
    context, so tests can call it directly. Returns ``{"text", "has_complex_layout"}``
    on success, raises ``ApplicationError`` on any policy or network failure.
    """
    current_url = url
    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=HTTP_TIMEOUT,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        # Manual redirect loop: re-validate every hop AND stream every
        # response under a size cap in a single request. The earlier version
        # called ``client.get`` first (buffering the whole body unconditionally)
        # and only then decided to stream — a large non-redirect response
        # therefore bypassed the cap entirely. Using ``client.stream`` as the
        # single entry point closes that OOM window. (Tier 0 review follow-up.)
        for _ in range(MAX_REDIRECTS + 1):
            await _assert_url_is_public(current_url)
            async with client.stream("GET", current_url) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        html = ""
                        break
                    current_url = urljoin(current_url, location)
                    continue
                response.raise_for_status()
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_BYTES:
                        raise ApplicationError(
                            f"Response exceeded {MAX_BYTES} bytes",
                            type="response_too_large",
                        )
                    chunks.append(chunk)
                html = b"".join(chunks).decode("utf-8", errors="replace")
                break
        else:
            raise ApplicationError(
                f"Too many redirects (>{MAX_REDIRECTS})",
                type="too_many_redirects",
            )

    # trafilatura is sync and CPU-bound on large pages; offload to thread.
    text = await asyncio.to_thread(_extract, html)
    matches = COMPLEX_MARKER_PATTERN.findall(text)
    return {"text": text, "has_complex_layout": len(matches) >= COMPLEX_THRESHOLD}


@activity.defn(name="scrape_web_url")
async def scrape_web_url(inp: dict) -> dict:
    url: str = inp["url"]
    activity.logger.info("Scraping web URL: %s", url)
    result = await _scrape_impl(url)
    activity.heartbeat("extraction complete")
    activity.logger.info(
        "Web scrape complete: %d chars, complex=%s",
        len(result["text"]),
        result["has_complex_layout"],
    )
    return result
