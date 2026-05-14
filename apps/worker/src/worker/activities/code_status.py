"""Typed status constants for ``code_runs.status`` transitions."""
from __future__ import annotations

from typing import Literal

CodeRunStatus = Literal[
    "pending",
    "running",
    "awaiting_feedback",
    "completed",
    "max_turns",
    "cancelled",
    "abandoned",
    "failed",
]
