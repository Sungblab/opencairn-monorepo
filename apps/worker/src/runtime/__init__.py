"""OpenCairn agent runtime — thin facade over LangGraph + langchain-core."""
from runtime.agent import Agent
from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    AwaitingInput,
    CustomEvent,
    Handoff,
    ModelEnd,
    Scope,
    ToolResult,
    ToolUse,
)
from runtime.langgraph_bridge import stream_graph_as_events
from runtime.hooks import (
    AgentHook,
    HookChain,
    HookRegistry,
    ModelHook,
    ModelRequest,
    ModelResponse,
    ToolHook,
)
from runtime.tools import (
    Tool,
    ToolContext,
    get_tool,
    get_tools_for_agent,
    hash_input,
    tool,
)

__all__ = [
    "Agent",
    "AgentEnd",
    "AgentError",
    "AgentEvent",
    "AgentHook",
    "AgentStart",
    "AwaitingInput",
    "CustomEvent",
    "Handoff",
    "HookChain",
    "HookRegistry",
    "ModelEnd",
    "ModelHook",
    "ModelRequest",
    "ModelResponse",
    "Scope",
    "Tool",
    "ToolContext",
    "ToolHook",
    "ToolResult",
    "ToolUse",
    "get_tool",
    "get_tools_for_agent",
    "hash_input",
    "stream_graph_as_events",
    "tool",
]
