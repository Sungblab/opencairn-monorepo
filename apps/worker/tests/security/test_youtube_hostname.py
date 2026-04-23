"""Worker-side hostname guard for the ``ingest_youtube`` activity.

Tier 1 item 1-4 (Plan 3 C-2) closes the gap where the worker blindly
trusted the dispatch payload: if any future bug lets a non-YouTube URL
reach ``youtube_activity`` with ``mime=x-opencairn/youtube``, yt-dlp's
generic extractor would happily download from arbitrary sites.

The ``_assert_youtube_url`` helper re-validates the hostname against the
same allowlist the API enforces, and is called both at the activity
entry point and immediately before ``yt_dlp.YoutubeDL.extract_info`` so
neither path can be bypassed.
"""
from __future__ import annotations

import pytest

from worker.activities.youtube_activity import _assert_youtube_url


class TestAcceptsYouTubeHosts:
    @pytest.mark.parametrize(
        "url",
        [
            "https://youtube.com/watch?v=abc",
            "https://www.youtube.com/watch?v=abc",
            "https://m.youtube.com/watch?v=abc",
            "https://music.youtube.com/watch?v=abc",
            "https://youtu.be/abc",
            # arbitrary subdomain of youtube.com
            "https://studio.youtube.com/video/abc",
        ],
    )
    def test_youtube_urls_pass(self, url: str) -> None:
        _assert_youtube_url(url)  # does not raise

    def test_http_scheme_also_allowed(self) -> None:
        # The API normalises to https but we do not want to break legacy
        # payloads that somehow carry http://. The SSRF concern is about
        # HOSTNAME, not scheme, and yt-dlp upgrades to https anyway.
        _assert_youtube_url("http://youtube.com/watch?v=abc")


class TestRejectsNonYouTubeHosts:
    @pytest.mark.parametrize(
        "url",
        [
            # blatant non-YouTube
            "https://evil.example.com/video",
            # look-alike domain (would trip a naive contains() check)
            "https://youtube.com.evil.example.com/watch?v=abc",
            # path-only spoof
            "https://evil.example.com/youtube.com",
            # IP literal (generic extractor would try it)
            "https://10.0.0.5/",
            "https://127.0.0.1/",
            # internal service
            "https://minio:9000/bucket",
        ],
    )
    def test_non_youtube_raises(self, url: str) -> None:
        with pytest.raises(ValueError, match="youtube_activity"):
            _assert_youtube_url(url)

    def test_non_http_scheme_rejected(self) -> None:
        with pytest.raises(ValueError, match="non-http"):
            _assert_youtube_url("file:///etc/passwd")
        with pytest.raises(ValueError, match="non-http"):
            _assert_youtube_url("ftp://youtube.com/")

    def test_missing_hostname_rejected(self) -> None:
        with pytest.raises(ValueError, match="missing hostname"):
            _assert_youtube_url("https:///watch?v=abc")

    def test_case_insensitive_host(self) -> None:
        # Attackers often rely on uppercase bypasses of lowercase regex.
        _assert_youtube_url("https://YouTube.com/watch?v=abc")
        _assert_youtube_url("https://WWW.YOUTUBE.COM/watch?v=abc")
