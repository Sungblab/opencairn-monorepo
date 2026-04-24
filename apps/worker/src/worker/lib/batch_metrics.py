"""Structured log events for the Plan 3b batch-embed path.

Plan 3b §B4 originally named four Prometheus counters. The worker doesn't
have an active Prometheus exporter (``pyproject.toml`` has an optional
``otel`` extra, not wired), so the interim contract is **stdlib logs
with a stable ``event`` field**. Ops can scrape these via Loki /
CloudWatch Logs Insights today, and a future Prometheus exporter can
subscribe to the same log records without rename churn.

All events share the logger name ``worker.batch_embed`` so dashboards
can filter on a single namespace. Each event carries typed extras; the
emitter keeps the set of event names closed so dashboard breakages at
rename time are caught at dev-test, not in production.

Events
------

- ``batch_embed.submit``    — emitted once per batch start.
  Fields: ``workspace_id``, ``input_count``, ``provider_batch_name``,
  ``batch_id``.
- ``batch_embed.poll_done`` — emitted once per terminal poll (done=True).
  Fields: ``batch_id``, ``state``, ``success_count``, ``failure_count``.
- ``batch_embed.fetch``     — emitted once per successful fetch.
  Fields: ``batch_id``, ``duration_seconds``, ``success_count``,
  ``failure_count``.
- ``batch_embed.fallback``  — emitted once per eligible-but-failed
  batch. Fields: ``reason``, ``input_count``, plus optional
  ``workspace_id``.

Routine skip events (``too_small``, ``flag_off``) are **not** emitted —
they happen on every non-batched call and would flood the stream
without ops value.
"""
from __future__ import annotations

import logging
from typing import Any

_LOGGER_NAME = "worker.batch_embed"
_logger = logging.getLogger(_LOGGER_NAME)

# Closed set — new events require a code change + test. Fallback is the
# only WARNING-level event; the rest are INFO.
_EVENT_LEVELS: dict[str, int] = {
    "batch_embed.submit": logging.INFO,
    "batch_embed.poll_done": logging.INFO,
    "batch_embed.fetch": logging.INFO,
    "batch_embed.fallback": logging.WARNING,
}


def emit_event(event: str, **fields: Any) -> None:
    """Emit a structured batch-embed event log record.

    The ``event`` name becomes the log message AND an ``event`` field on
    the record — dashboards can match on either, whichever their
    scraping pipeline exposes cleanly.

    Raises
    ------
    ValueError
        If ``event`` is not a known event name. Catching typos at emit
        time prevents dashboards going silently blank after a rename.
    """
    if event not in _EVENT_LEVELS:
        raise ValueError(
            f"unknown batch_embed event: {event!r} (known: "
            f"{sorted(_EVENT_LEVELS)})"
        )
    extras: dict[str, Any] = dict(fields)
    extras["event"] = event
    _logger.log(_EVENT_LEVELS[event], event, extra=extras)
