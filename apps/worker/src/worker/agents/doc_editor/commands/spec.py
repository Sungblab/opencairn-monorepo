"""Plan 11B Phase A — CommandSpec dataclass."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


OutputMode = Literal["diff", "comment", "insert"]


@dataclass(frozen=True)
class CommandSpec:
    """Per-slash-command configuration. Phase A all commands are pure LLM
    (no tools). The output_mode is always 'diff' here; Phase B adds
    'comment' for /factcheck and Phase C may add 'insert' for /summarize."""

    name: str
    system_prompt: str
    output_mode: OutputMode
    max_selection_chars: int = 4000
