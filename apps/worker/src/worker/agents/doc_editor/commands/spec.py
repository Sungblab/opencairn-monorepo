"""Plan 11B — CommandSpec dataclass."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


OutputMode = Literal["diff", "comment", "insert"]


@dataclass(frozen=True)
class CommandSpec:
    """Per-slash-command configuration.

    Phase A commands keep ``tools=()`` and use the direct JSON-generation
    path. Phase B commands opt into the tool loop by listing builtin tool
    names; names keep the dataclass frozen and Temporal-friendly.
    """

    name: str
    system_prompt: str
    output_mode: OutputMode
    max_selection_chars: int = 4000
    tools: tuple[str, ...] = field(default_factory=tuple)
