"""LangGraph astream_events -> AgentEvent adapter.

Single adapter attached to each graph; converts LangGraph's native event stream
into OpenCairn's AgentEvent stream.
"""
from __future__ import annotations

import time
from collections.abc import AsyncGenerator
from typing import Any

from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    CustomEvent,
    ModelEnd,
    ToolResult,
    ToolUse,
)
from runtime.tools import ToolContext, hash_input


async def stream_graph_as_events(
    graph: Any,  # langgraph CompiledGraph, typed Any to avoid hard import
    input: dict[str, Any],
    ctx: ToolContext,
    *,
    agent_name: str,
    thread_id: str,
) -> AsyncGenerator[AgentEvent, None]:
    """Consume graph.astream_events() and emit AgentEvent items.

    Maps:
      on_chain_start -> AgentStart (only for the graph root)
      on_chain_end -> AgentEnd (only for the graph root)
      on_llm_end -> ModelEnd
      on_tool_start -> ToolUse
      on_tool_end -> ToolResult
      custom dispatches -> CustomEvent
    """
    seq = 0
    start_time = time.time()

    def _next_seq() -> int:
        nonlocal seq
        seq += 1
        return seq - 1

    def _base(ts: float | None = None) -> dict[str, Any]:
        return {
            "run_id": ctx.run_id,
            "workspace_id": ctx.workspace_id,
            "agent_name": agent_name,
            "seq": _next_seq(),
            "ts": ts if ts is not None else time.time(),
            "parent_seq": None,
        }

    tool_call_ids: dict[str, str] = {}  # langgraph run_id -> our tool_call_id

    yield AgentStart(**_base(start_time), type="agent_start", scope=ctx.scope, input=input)

    try:
        config = {"configurable": {"thread_id": thread_id}}
        final_state: Any = None
        async for ev in graph.astream_events(input, config=config, version="v2"):
            name: str = ev.get("event", "")
            data: dict[str, Any] = ev.get("data", {})
            run_id_lg: str = ev.get("run_id", "")

            if name in ("on_chat_model_end", "on_llm_end"):
                usage = _extract_usage(data.get("output"))
                yield ModelEnd(
                    **_base(),
                    type="model_end",
                    model_id=ev.get("metadata", {}).get("ls_model_name", "unknown"),
                    prompt_tokens=usage["prompt_tokens"],
                    completion_tokens=usage["completion_tokens"],
                    cached_tokens=usage.get("cached_tokens", 0),
                    cost_krw=0,  # computed by TokenCounterHook after the fact
                    finish_reason=usage.get("finish_reason", "stop"),
                    latency_ms=int(usage.get("latency_ms", 0)),
                )
            elif name == "on_tool_start":
                tool_input = data.get("input", {})
                call_id = f"call-{run_id_lg}"
                tool_call_ids[run_id_lg] = call_id
                tool_name = ev.get("name", "unknown")
                args = tool_input if isinstance(tool_input, dict) else {"input": tool_input}
                yield ToolUse(
                    **_base(),
                    type="tool_use",
                    tool_call_id=call_id,
                    tool_name=tool_name,
                    input_args=args,
                    input_hash=hash_input(args),
                    concurrency_safe=False,  # runtime scheduler knows better; this is just a log
                )
            elif name == "on_tool_end":
                call_id = tool_call_ids.get(run_id_lg, f"call-{run_id_lg}")
                out = data.get("output")
                yield ToolResult(
                    **_base(),
                    type="tool_result",
                    tool_call_id=call_id,
                    ok=True,
                    output=_coerce_json(out),
                    duration_ms=0,
                )
            elif name == "on_chain_end":
                # Capture final state from root chain end
                final_state = data.get("output", final_state)
            elif name == "on_custom_event":
                yield CustomEvent(
                    **_base(),
                    type="custom",
                    label=ev.get("name", "custom"),
                    payload=data if isinstance(data, dict) else {"value": data},
                )

        duration = int((time.time() - start_time) * 1000)
        output_dict = (
            final_state
            if isinstance(final_state, dict)
            else {"output": final_state}
            if final_state is not None
            else {}
        )
        yield AgentEnd(
            **_base(),
            type="agent_end",
            output=output_dict,
            duration_ms=duration,
        )
    except Exception as e:  # noqa: BLE001 — bubble up after emitting
        yield AgentError(
            **_base(),
            type="agent_error",
            error_class=type(e).__name__,
            message=str(e)[:500],
            retryable=_is_retryable(e),
        )
        raise


def _extract_usage(output: Any) -> dict[str, Any]:
    """Best-effort extraction of token usage from langchain-core message output."""
    if output is None:
        return {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0}
    usage = getattr(output, "usage_metadata", None)
    if usage:
        return {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "cached_tokens": usage.get("input_token_details", {}).get("cache_read", 0),
            "finish_reason": "stop",
        }
    return {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0}


def _coerce_json(val: Any) -> Any:
    """Make langgraph tool output JSON-serializable."""
    if val is None:
        return None
    if isinstance(val, (str, int, float, bool, list, dict)):
        return val
    if hasattr(val, "model_dump"):
        return val.model_dump()
    return str(val)


def _is_retryable(err: Exception) -> bool:
    name = type(err).__name__
    return name in {"TimeoutError", "ConnectionError", "RateLimitError", "APIConnectionError"}


__all__ = ["stream_graph_as_events"]
