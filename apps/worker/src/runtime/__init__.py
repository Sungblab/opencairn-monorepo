"""OpenCairn agent runtime — thin facade over LangGraph + langchain-core.

12 agents import only from this module. Direct imports of langgraph or
langchain_core from apps/worker/src/worker/agents/ are forbidden (see lint rule in Task 14).
"""
from runtime.agent import Agent
from runtime.default_hooks import (
    LatencyHook,
    RunTotals,
    SentryHook,
    TokenCounterHook,
    TrajectoryWriterHook,
)
from runtime.eval import (
    AgentEvaluator,
    DEFAULT_CRITERIA,
    EvalCase,
    EvalResult,
    ExpectedHandoff,
    ExpectedToolCall,
    ScoreResult,
    load_case_file,
    load_cases,
    score_trajectory,
)
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
from runtime.hooks import (
    AgentHook,
    HookChain,
    HookRegistry,
    ModelHook,
    ModelRequest,
    ModelResponse,
    ToolHook,
)
from runtime.langgraph_bridge import stream_graph_as_events
from runtime.reducers import keep_last_n
from runtime.temporal import AgentAwaitingInputError, make_thread_id
from runtime.tool_declarations import (
    build_gemini_declarations,
    build_ollama_declarations,
)
from runtime.tools import (
    Tool,
    ToolContext,
    get_tool,
    get_tools_for_agent,
    hash_input,
    tool,
)
from runtime.trajectory import (
    LocalFSTrajectoryStorage,
    TrajectoryStorage,
    TrajectoryWriter,
    resolve_storage_from_env,
)

__all__ = [
    "Agent",
    "AgentAwaitingInputError",
    "AgentEnd",
    "AgentError",
    "AgentEvaluator",
    "AgentEvent",
    "AgentHook",
    "AgentStart",
    "AwaitingInput",
    "CustomEvent",
    "DEFAULT_CRITERIA",
    "EvalCase",
    "EvalResult",
    "ExpectedHandoff",
    "ExpectedToolCall",
    "Handoff",
    "HookChain",
    "HookRegistry",
    "LatencyHook",
    "LocalFSTrajectoryStorage",
    "ModelEnd",
    "ModelHook",
    "ModelRequest",
    "ModelResponse",
    "RunTotals",
    "Scope",
    "ScoreResult",
    "SentryHook",
    "TokenCounterHook",
    "Tool",
    "ToolContext",
    "ToolHook",
    "ToolResult",
    "ToolUse",
    "TrajectoryStorage",
    "TrajectoryWriter",
    "TrajectoryWriterHook",
    "build_gemini_declarations",
    "build_ollama_declarations",
    "get_tool",
    "get_tools_for_agent",
    "hash_input",
    "keep_last_n",
    "load_case_file",
    "load_cases",
    "make_thread_id",
    "resolve_storage_from_env",
    "score_trajectory",
    "stream_graph_as_events",
    "tool",
]
