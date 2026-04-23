"""SSRF and DoS defenses for the ``scrape_web_url`` ingest activity.

Tier 0 item 0-2 (Plan 3 C-1) closed the open-fetch flaw; the Tier 0 PR
follow-up (this file's current shape) tightened two gaps that emerged
from review:

* The scraper went through a single ``client.stream`` entry point — the
  earlier draft did ``client.get`` first and only then streamed, which
  buffered the entire body of a non-redirect response BEFORE the size
  cap could fire. A hostile server returning a 20 GB body therefore
  bypassed ``MAX_BYTES`` entirely. Mocks below walk the stream path on
  every hop and prove the cap triggers even without any redirect.
* DNS lookups moved to ``asyncio.to_thread``. These tests stay
  compatible by patching the inner sync helper.

These tests exercise the public ``scrape_web_url`` entry point (via its
pure core ``_scrape_impl``) across the adversary-relevant axes:

1. Scheme whitelist (http/https only).
2. Private / loopback / link-local IP literals, IPv4 and IPv6.
3. Hostnames that resolve to private addresses (DNS rebinding defense).
4. Redirects to private addresses get blocked at the next hop.
5. Redirect chains longer than the max terminate.
6. Response size cap enforced (including on a non-redirect first hop,
   so a direct large-body response cannot OOM a worker slot).
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from temporalio.exceptions import ApplicationError

from worker.activities.web_activity import _scrape_impl


class _StreamResponse:
    """Minimal async stand-in for ``httpx.Response`` in streaming mode.

    The real client yields an object that supports ``status_code``,
    ``headers``, ``raise_for_status``, and ``aiter_bytes()``. Tests drive
    each hop by constructing one of these with a known status and an
    optional chunk iterator.
    """

    def __init__(
        self,
        *,
        status_code: int,
        headers: dict[str, str] | None = None,
        chunks: list[bytes] | None = None,
    ) -> None:
        self.status_code = status_code
        self.headers = headers or {}
        self._chunks = chunks or []

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    async def aiter_bytes(self) -> AsyncIterator[bytes]:
        for chunk in self._chunks:
            yield chunk


class _StreamCtx:
    def __init__(self, response: _StreamResponse) -> None:
        self._response = response

    async def __aenter__(self) -> _StreamResponse:
        return self._response

    async def __aexit__(self, *_args: object) -> None:
        return None


def _mock_client(*responses: _StreamResponse) -> MagicMock:
    """Build an ``AsyncClient`` mock whose ``stream`` returns each response
    in order. Tests drive multi-hop redirect flows by passing one response
    per hop.
    """
    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    ctxs = [_StreamCtx(r) for r in responses]
    client.stream = MagicMock(side_effect=ctxs)
    return client


def _patch_dns(ip: str = "93.184.216.34") -> Any:
    # Patch the synchronous helper the async one delegates to.
    return patch(
        "worker.activities.web_activity._resolve_host_sync",
        return_value=[ip],
    )


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
    reject when resolution yields a private address."""
    with _patch_dns("10.0.0.5"):
        with pytest.raises(ApplicationError) as info:
            await _scrape_impl("http://rebind.attacker.test/")
    assert info.value.non_retryable is True


async def test_redirect_to_private_ip_blocked() -> None:
    """A public first hop that redirects to a private address must be
    rejected at the follow-up, not silently pursued."""
    redirect = _StreamResponse(
        status_code=302, headers={"location": "http://127.0.0.1/admin"}
    )
    client = _mock_client(redirect)

    with _patch_dns(), patch(
        "worker.activities.web_activity.httpx.AsyncClient",
        return_value=client,
    ):
        with pytest.raises(ApplicationError) as info:
            await _scrape_impl("http://example.com/")
    assert info.value.non_retryable is True


async def test_redirect_without_location_header_raises() -> None:
    """PR #11 review follow-up: a 3xx response without a ``Location`` header
    is malformed per RFC 7231 §7.1.2. The earlier code silently broke out of
    the redirect loop with an empty body, which meant downstream ingest
    would embed and index an empty note. The activity must surface the
    failure as non-retryable so the workflow parks the job instead of
    quietly succeeding or retrying forever.
    """
    missing_location = _StreamResponse(status_code=302, headers={})
    client = _mock_client(missing_location)

    with _patch_dns(), patch(
        "worker.activities.web_activity.httpx.AsyncClient",
        return_value=client,
    ):
        with pytest.raises(ApplicationError) as info:
            await _scrape_impl("http://example.com/")
    assert info.value.type == "invalid_redirect"
    assert info.value.non_retryable is True
    assert "location" in str(info.value).lower()


async def test_redirect_loop_bounded() -> None:
    """A redirect chain longer than ``MAX_REDIRECTS`` must terminate —
    never silently trust a site that keeps redirecting to public hops."""
    loop = [
        _StreamResponse(
            status_code=302, headers={"location": "http://example.com/next"}
        )
        for _ in range(10)
    ]
    client = _mock_client(*loop)

    with _patch_dns(), patch(
        "worker.activities.web_activity.httpx.AsyncClient",
        return_value=client,
    ):
        with pytest.raises(ApplicationError) as info:
            await _scrape_impl("http://example.com/start")
    assert "redirect" in str(info.value).lower()


async def test_response_size_cap_enforced_on_direct_response() -> None:
    """Non-redirect responses must stream under the size cap. The prior
    implementation called ``client.get`` first (buffering the whole body
    without any cap) then streamed a second request — so this scenario
    OOMed the worker before the stream was even reached. The fix
    short-circuits on the single stream path.
    """
    chunks = [b"x" * (1024 * 1024)] * 50  # 50 MB, past the 10 MB cap
    big = _StreamResponse(
        status_code=200,
        headers={"content-type": "text/html"},
        chunks=chunks,
    )
    client = _mock_client(big)

    with _patch_dns(), patch(
        "worker.activities.web_activity.httpx.AsyncClient",
        return_value=client,
    ):
        with pytest.raises(ApplicationError) as info:
            await _scrape_impl("http://example.com/big")
    # Size-cap errors are retryable (real transient flakes can look similar),
    # so non_retryable is not asserted here.
    assert "size" in str(info.value).lower() or "bytes" in str(info.value).lower()


async def test_single_stream_call_per_hop_no_extra_get() -> None:
    """Regression test for the Tier 0 review follow-up: the scraper must
    not call ``client.get`` in addition to ``client.stream`` on the happy
    path. Doing so would re-open the double-fetch window where a body is
    buffered before the size cap applies.
    """
    ok = _StreamResponse(
        status_code=200,
        headers={"content-type": "text/html"},
        chunks=[b"<html><body>ok</body></html>"],
    )
    client = _mock_client(ok)
    # ``get`` must never be called. MagicMock would happily return another
    # mock if we didn't assert this, so we guard explicitly.
    client.get = MagicMock(side_effect=AssertionError("client.get must not be called"))

    with _patch_dns(), patch(
        "worker.activities.web_activity.httpx.AsyncClient",
        return_value=client,
    ):
        result = await _scrape_impl("http://example.com/")
    assert cast(dict, result)["text"]
    assert client.stream.call_count == 1
    client.get.assert_not_called()


async def test_dns_resolution_runs_off_event_loop() -> None:
    """``socket.getaddrinfo`` is blocking. The async resolver must bounce
    it through ``asyncio.to_thread`` so the event loop stays responsive
    under load.
    """
    import asyncio as _asyncio

    original_to_thread = _asyncio.to_thread
    calls: list[str] = []

    async def spy(func: Any, *args: Any, **kwargs: Any) -> Any:
        calls.append(getattr(func, "__name__", repr(func)))
        return await original_to_thread(func, *args, **kwargs)

    ok = _StreamResponse(
        status_code=200,
        headers={"content-type": "text/html"},
        chunks=[b"<html>ok</html>"],
    )
    client = _mock_client(ok)
    with _patch_dns(), patch(
        "worker.activities.web_activity.asyncio.to_thread", new=spy
    ), patch(
        "worker.activities.web_activity.httpx.AsyncClient",
        return_value=client,
    ):
        await _scrape_impl("http://example.com/")
    # The resolver is what matters — trafilatura's offload is also on
    # asyncio.to_thread and can remain, but DNS MUST go through it. The
    # sync helper may be patched (MagicMock) whose repr includes its name.
    assert any("_resolve_host_sync" in c for c in calls)
