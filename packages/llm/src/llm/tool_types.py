"""Provider-neutral intermediate representation for tool calling.

The `ToolLoopExecutor` depends only on these types; each `LLMProvider`
translates its native format to/from these shapes. `assistant_message`
is intentionally opaque so provider-specific metadata (Gemini 3 thought
signatures, Anthropic cache_control, etc.) pass through the loop
unchanged when re-injected as conversation history.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ToolUse:
    id: str
    name: str
    args: dict[str, Any]
    thought_signature: bytes | None = None

    def args_hash(self) -> str:
        canonical = json.dumps(self.args, sort_keys=True, default=str)
        return hashlib.sha256(canonical.encode()).hexdigest()[:16]


@dataclass(frozen=True)
class ToolResult:
    tool_use_id: str
    name: str
    data: dict[str, Any] | str
    is_error: bool = False


@dataclass(frozen=True)
class UsageCounts:
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int = 0


@dataclass(frozen=True)
class AssistantTurn:
    final_text: str | None
    tool_uses: tuple[ToolUse, ...]
    assistant_message: Any
    usage: UsageCounts
    stop_reason: str
    structured_output: dict | None = None
