"""Every IngestWorkflow activity dispatch must specify
``heartbeat_timeout``.

Without ``heartbeat_timeout`` Temporal can't distinguish a hung worker from a
long-running activity, so the controller waits the full
``schedule_to_close_timeout`` (5-30 min) before retrying.

We pin both layers:

* a static text scan ensures no future ``workflow.execute_activity(...)`` call
  in ``ingest_workflow.py`` drops the kwarg, and
* parametrised dynamic dispatch tests ensure each MIME branch + the ancillary
  ``emit_started`` call actually receive ``heartbeat_timeout`` at runtime.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from inspect import getsource
from unittest.mock import MagicMock, patch

import pytest

_TEST_LOGGER = logging.getLogger("test_ingest_heartbeat")


def _inp(mime: str = "application/pdf"):
    from worker.workflows.ingest_workflow import IngestInput

    return IngestInput(
        object_key="uploads/u/x.bin",
        file_name="x.bin",
        mime_type=mime,
        user_id="user-1",
        project_id="proj-1",
        note_id=None,
        workspace_id="ws-1",
    )


def test_every_execute_activity_call_passes_heartbeat_timeout():
    """Static: every ``workflow.execute_activity(...)`` block in
    ``ingest_workflow.py`` must contain a ``heartbeat_timeout=`` kwarg.
    Failing here means a new dispatch was added without the kwarg —
    a silent heartbeat regression."""
    from worker.workflows import ingest_workflow

    src = getsource(ingest_workflow)
    needle = "workflow.execute_activity("
    blocks: list[str] = []
    i = 0
    while True:
        idx = src.find(needle, i)
        if idx == -1:
            break
        depth = 0
        j = idx + len("workflow.execute_activity")
        while j < len(src):
            ch = src[j]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    blocks.append(src[idx : j + 1])
                    break
            j += 1
        i = j + 1

    assert blocks, "expected at least one execute_activity call in ingest_workflow.py"
    missing = [b[:120].replace("\n", " ") for b in blocks if "heartbeat_timeout" not in b]
    assert not missing, (
        "execute_activity calls without heartbeat_timeout — heartbeat regression: "
        + " | ".join(missing)
    )


@pytest.mark.parametrize(
    "mime,activity_name",
    [
        ("application/pdf", "parse_pdf"),
        ("audio/mp3", "transcribe_audio"),
        ("video/mp4", "transcribe_audio"),
        ("image/png", "analyze_image"),
        ("x-opencairn/youtube", "ingest_youtube"),
        ("x-opencairn/web-url", "scrape_web_url"),
        ("text/plain", "read_text_object"),
        (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "parse_office",
        ),
        ("application/x-hwp", "parse_hwp"),
    ],
)
@pytest.mark.asyncio
async def test_dispatch_activity_receives_heartbeat_timeout(
    monkeypatch, mime: str, activity_name: str
):
    """Dynamic: the primary parse activity for each MIME branch must be invoked
    with ``heartbeat_timeout`` strictly less than ``schedule_to_close_timeout``."""
    monkeypatch.delenv("FEATURE_CONTENT_ENRICHMENT", raising=False)

    from worker.workflows.ingest_workflow import IngestWorkflow

    captured: list[tuple[str, dict]] = []

    async def fake_activity(name, *_args, **kwargs):
        captured.append((name, kwargs))
        if name in {"parse_pdf", "parse_office", "parse_hwp"}:
            return {"text": "hello", "has_complex_layout": False}
        if name == "scrape_web_url":
            return {"text": "hello", "has_complex_layout": False}
        if name in {"transcribe_audio", "ingest_youtube"}:
            return {"transcript": "hello"}
        if name == "analyze_image":
            return {"description": "an image"}
        if name == "read_text_object":
            return {"text": "hello"}
        if name == "create_source_note":
            return "note-1"
        return {}

    wf = IngestWorkflow()
    with patch(
        "temporalio.workflow.execute_activity", side_effect=fake_activity
    ), patch("temporalio.workflow.logger", _TEST_LOGGER):
        await wf._run_pipeline(_inp(mime), "wf-hb", 0)

    primary = next((kw for n, kw in captured if n == activity_name), None)
    assert primary is not None, (
        f"primary activity {activity_name} not invoked; "
        f"captured={[n for n, _ in captured]}"
    )
    assert "heartbeat_timeout" in primary, (
        f"{activity_name} missing heartbeat_timeout"
    )
    ht = primary["heartbeat_timeout"]
    assert isinstance(ht, timedelta), f"expected timedelta, got {type(ht)!r}"
    sch = primary.get("schedule_to_close_timeout")
    assert sch is None or ht < sch, (
        f"heartbeat_timeout ({ht}) must be < schedule_to_close_timeout ({sch})"
    )
    assert timedelta(seconds=10) <= ht <= timedelta(minutes=5), (
        f"heartbeat_timeout {ht} outside [10s, 5min] sanity range"
    )


@pytest.mark.asyncio
async def test_emit_started_call_passes_heartbeat_timeout(monkeypatch):
    """The best-effort ``emit_started`` call inside ``run()`` must also pass
    ``heartbeat_timeout`` — even short Redis publishes can hang on a dead node."""
    monkeypatch.delenv("FEATURE_CONTENT_ENRICHMENT", raising=False)

    from worker.workflows.ingest_workflow import IngestWorkflow

    captured: list[tuple[str, dict]] = []

    async def fake_activity(name, *_args, **kwargs):
        captured.append((name, kwargs))
        if name == "parse_pdf":
            return {"text": "hello", "has_complex_layout": False}
        if name == "create_source_note":
            return "note-1"
        return {}

    fake_info = MagicMock()
    fake_info.workflow_id = "wf-hb"
    fake_now = MagicMock()
    fake_now.timestamp.return_value = 1.0

    wf = IngestWorkflow()
    with patch(
        "temporalio.workflow.execute_activity", side_effect=fake_activity
    ), patch("temporalio.workflow.logger", _TEST_LOGGER), patch(
        "temporalio.workflow.info", return_value=fake_info
    ), patch("temporalio.workflow.now", return_value=fake_now):
        await wf.run(_inp("application/pdf"))

    emit = next((kw for n, kw in captured if n == "emit_started"), None)
    assert emit is not None, "emit_started should be called once at run() start"
    assert "heartbeat_timeout" in emit, (
        "emit_started missing heartbeat_timeout"
    )
