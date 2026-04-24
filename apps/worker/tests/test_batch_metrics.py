"""Unit tests for :mod:`worker.lib.batch_metrics`.

Plan 3b §B4 originally named four Prometheus counters. We don't have
Prometheus wiring yet (see ``apps/worker/pyproject.toml`` optional
``otel`` extra — not active). The interim contract is **structured log
events** with a stable ``event`` name field so Loki / CloudWatch Logs
Insights can derive the same counters, and a future Prometheus exporter
can subscribe to the logs without a rename sweep.

Event names (stable wire format):
  - ``batch_embed.submit``       — one per batch start
  - ``batch_embed.poll_done``    — one per terminal poll
  - ``batch_embed.fetch``        — one per successful fetch
  - ``batch_embed.fallback``     — one per eligible-but-failed batch

Routine skip events (``too_small``, ``flag_off``) are NOT emitted — they
happen on every non-batched call and would swamp the log stream without
ops value.
"""
from __future__ import annotations

import json
import logging

import pytest

from worker.lib.batch_metrics import emit_event


class TestEmitEvent:
    def test_emits_event_name_as_log_message(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger="worker.batch_embed"):
            emit_event("batch_embed.submit", workspace_id="ws-1", input_count=10)

        records = [r for r in caplog.records if r.name == "worker.batch_embed"]
        assert len(records) == 1
        assert records[0].message == "batch_embed.submit"

    def test_attaches_fields_as_record_extras(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger="worker.batch_embed"):
            emit_event(
                "batch_embed.fetch",
                batch_id="row-7",
                duration_seconds=42.5,
                success_count=100,
                failure_count=0,
            )

        rec = next(r for r in caplog.records if r.name == "worker.batch_embed")
        assert rec.__dict__["event"] == "batch_embed.fetch"
        assert rec.__dict__["batch_id"] == "row-7"
        assert rec.__dict__["duration_seconds"] == 42.5
        assert rec.__dict__["success_count"] == 100
        assert rec.__dict__["failure_count"] == 0

    def test_fallback_events_are_warning_level(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Fallback means something that SHOULD have batched didn't —
        ops wants these surfaced in the warning stream.
        """
        with caplog.at_level(logging.INFO, logger="worker.batch_embed"):
            emit_event(
                "batch_embed.fallback",
                reason="provider_unsupported",
                input_count=50,
            )

        rec = next(r for r in caplog.records if r.name == "worker.batch_embed")
        assert rec.levelno == logging.WARNING

    def test_non_fallback_events_are_info_level(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger="worker.batch_embed"):
            emit_event("batch_embed.submit", workspace_id="ws-1")
            emit_event("batch_embed.poll_done", state="succeeded")
            emit_event("batch_embed.fetch", batch_id="row-1")

        records = [
            r for r in caplog.records if r.name == "worker.batch_embed"
        ]
        assert len(records) == 3
        assert all(r.levelno == logging.INFO for r in records)

    def test_none_fields_are_preserved_verbatim(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Librarian runs set workspace_id=None — the emitter must not
        crash or stringify 'None'; log scrapers rely on a true null to
        distinguish cross-workspace maintenance runs.
        """
        with caplog.at_level(logging.INFO, logger="worker.batch_embed"):
            emit_event(
                "batch_embed.submit",
                workspace_id=None,
                input_count=50,
            )

        rec = next(r for r in caplog.records if r.name == "worker.batch_embed")
        assert rec.__dict__["workspace_id"] is None

    def test_unknown_event_name_rejected(self) -> None:
        """Typos in event names break downstream dashboards silently
        — catch them at emit time.
        """
        with pytest.raises(ValueError, match="unknown batch_embed event"):
            emit_event("batch_embed.completed", batch_id="x")  # not a real event

    def test_serialises_cleanly_to_json(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Loki/CloudWatch scrape raw log JSON — the extras must round-
        trip through json.dumps without custom encoders.
        """
        with caplog.at_level(logging.INFO, logger="worker.batch_embed"):
            emit_event(
                "batch_embed.fetch",
                batch_id="row-7",
                duration_seconds=1.5,
                success_count=10,
                failure_count=2,
            )

        rec = next(r for r in caplog.records if r.name == "worker.batch_embed")
        payload = {
            k: rec.__dict__[k]
            for k in (
                "event",
                "batch_id",
                "duration_seconds",
                "success_count",
                "failure_count",
            )
        }
        # Must not raise.
        json.dumps(payload)
