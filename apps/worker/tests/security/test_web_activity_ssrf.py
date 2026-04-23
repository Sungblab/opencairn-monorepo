"""SSRF defenses for the ``scrape_web_url`` ingest activity.

Tier 0 item 0-2 (Plan 3 C-1). The prior implementation let ``httpx`` hit
any host with ``follow_redirects=True`` and no IP filtering — which meant
AWS IMDS (``169.254.169.254``), internal MinIO/Postgres/Temporal/Hocuspocus,
and every RFC1918 host on the docker network were reachable from any
web-ingest task.

These tests exercise the public ``scrape_web_url`` entry point (via its
pure core ``_scrape_impl``) across four axes:

1. Scheme whitelist (http/https only)
2. Private / loopback / link-local IP literals
3. Hostnames that resolve to private addresses (DNS rebinding defense)
4. Redirects to private addresses get blocked at the next hop
5. Response size cap enforced (cannot exfil large internal pages)

The legitimate path is kept out of scope — those tests would need a live
HTTP server and are covered by the existing integration suite.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from temporalio.exceptions import ApplicationError

from worker.activities.web_activity import _scrape_impl


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://localhost/",
        "http://10.0.0.1/",
        "http://172.31.255.254/",
        "http://192.168.0.1/",
        "http://169.254.169.254/latest/",  # AWS / GCP / Azure IMDS
        "http://[::1]/",
        "http://[fe80::1]/",
    ],
)
async def test_private_ip_literals_blocked(url: str) -> None:
    with pytest.raises(ApplicationError) as info:
        await _scrape_impl(url)
    assert info.value.non_retryable is True


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/",
        "file:///etc/passwd",
        "gopher://attacker/",
        "javascript:alert(1)",
        "data:text/html,<h1>x</h1>",
    ],
)
async def test_non_http_schemes_blocked(url: str) -> None:
    with pytest.raises(ApplicationError) as info:
        await _scrape_impl(url)
    assert info.value.non_retryable is True


async def test_hostname_resolving_to_private_ip_blocked() -> None:
    """DNS rebinding defense: even if the scheme/host look public, we
    reject when ``getaddrinfo`` returns any private address."""
    with patch(
        "worker.activities.web_activity.socket.getaddrinfo",
        return_value=[(0, 0, 0, "", ("10.0.0.5", 0))],
    ):
        with pytest.raises(ApplicationError) as info:
            await _scrape_impl("http://rebind.attacker.test/")
    assert info.value.non_retryable is True


async def test_redirect_to_private_ip_blocked() -> None:
    """A public first hop that redirects to a private address must be
    rejected at the follow-up, not silently pursued."""
    public_response = MagicMock()
    public_response.status_code = 302
    public_response.headers = {"location": "http://127.0.0.1/admin"}
    public_response.text = ""

    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    client.get = AsyncMock(return_value=public_response)

    with patch(
        "worker.activities.web_activity.socket.getaddrinfo",
        return_value=[(0, 0, 0, "", ("93.184.216.34", 0))],
    ), patch(
        "worker.activities.web_activity.httpx.AsyncClient",
        return_value=client,
    ):
        with pytest.raises(ApplicationError) as info:
            await _scrape_impl("http://example.com/")
    assert info.value.non_retryable is True


async def test_redirect_loop_bounded() -> None:
    """A redirect chain longer than ``MAX_REDIRECTS`` must terminate —
    never silently trust a site that keeps redirecting to public hops."""
    loop_response = MagicMock()
    loop_response.status_code = 302
    loop_response.headers = {"location": "http://example.com/next"}
    loop_response.text = ""

    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    client.get = AsyncMock(return_value=loop_response)

    with patch(
        "worker.activities.web_activity.socket.getaddrinfo",
        return_value=[(0, 0, 0, "", ("93.184.216.34", 0))],
    ), patch(
        "worker.activities.web_activity.httpx.AsyncClient",
        return_value=client,
    ):
        with pytest.raises(ApplicationError) as info:
            await _scrape_impl("http://example.com/start")
    assert "redirect" in str(info.value).lower()


async def test_response_size_cap_enforced() -> None:
    """Responses larger than the cap must abort so a compromised or huge
    page cannot OOM a worker slot."""
    big_chunk = b"x" * (1024 * 1024)  # 1 MB

    async def aiter() -> "any":  # type: ignore[name-defined]
        for _ in range(50):  # 50 MB — well past the 10 MB cap
            yield big_chunk

    stream_response = MagicMock()
    stream_response.raise_for_status = MagicMock(return_value=None)
    stream_response.status_code = 200
    stream_response.headers = {"content-type": "text/html"}
    stream_response.aiter_bytes = lambda: aiter()

    class _StreamCtx:
        async def __aenter__(self) -> "MagicMock":
            return stream_response

        async def __aexit__(self, *_args: object) -> None:
            return None

    simple_response = MagicMock()
    simple_response.status_code = 200
    simple_response.headers = {"content-type": "text/html"}
    simple_response.text = ""

    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    client.get = AsyncMock(return_value=simple_response)
    client.stream = MagicMock(return_value=_StreamCtx())

    with patch(
        "worker.activities.web_activity.socket.getaddrinfo",
        return_value=[(0, 0, 0, "", ("93.184.216.34", 0))],
    ), patch(
        "worker.activities.web_activity.httpx.AsyncClient",
        return_value=client,
    ):
        with pytest.raises(ApplicationError) as info:
            await _scrape_impl("http://example.com/big")
    # Size-cap errors are retryable (transient flakes look similar to this
    # shape), so non_retryable is NOT asserted here.
    assert "size" in str(info.value).lower() or "bytes" in str(info.value).lower()
