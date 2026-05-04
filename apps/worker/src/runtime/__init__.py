"""OpenCairn agent runtime.

자체 ToolLoopExecutor 기반 (Plan 12 + Agent Runtime v2 Sub-A). LangGraph/LangChain은
사용하지 않음 — 신규 도입 검토는 ``docs/architecture/agent-platform-roadmap.md`` 참조.

12 agents import only from this module.
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
    DEFAULT_CRITERIA,
    AgentEvaluator,
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
from runtime.mcp import MCPCatalogResolver, build_mcp_tools_for_user
from runtime.reducers import keep_last_n
from runtime.temporal import AgentAwaitingInputError, make_thread_id
from runtime.tool_declarations import (
    build_gemini_declarations,
    build_ollama_declarations,
)
from runtime.tool_policy import (
    PermissionBroker,
    PermissionDecision,
    PermissionMode,
    ToolPolicy,
    ToolRisk,
    get_tool_policy,
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
    "MCPCatalogResolver",
    "PermissionBroker",
    "PermissionDecision",
    "PermissionMode",
    "RunTotals",
    "Scope",
    "ScoreResult",
    "SentryHook",
    "TokenCounterHook",
    "Tool",
    "ToolContext",
    "ToolHook",
    "ToolPolicy",
    "ToolResult",
    "ToolRisk",
    "ToolUse",
    "TrajectoryStorage",
    "TrajectoryWriter",
    "TrajectoryWriterHook",
    "build_gemini_declarations",
    "build_mcp_tools_for_user",
    "build_ollama_declarations",
    "get_tool",
    "get_tool_policy",
    "get_tools_for_agent",
    "hash_input",
    "keep_last_n",
    "load_case_file",
    "load_cases",
    "make_thread_id",
    "resolve_storage_from_env",
    "score_trajectory",
    "tool",
]
