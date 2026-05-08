"""CodeAgent Temporal activities — generation + feedback analysis.

Both activities are heartbeat-friendly and persist a CodeTurn after the
LLM call returns. Status transitions match the spec:
  running -> awaiting_feedback (after each turn)
  running -> {completed,max_turns,cancelled,abandoned,failed} (workflow end)

Persistence calls go through ``worker.lib.api_client``
(``post_internal``/``patch_internal``) to ``/api/internal/code/*`` routes
added in Task 9. The activity layer never touches Postgres directly —
apps/api owns all business logic.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from temporalio import activity

from worker.activities.code_status import CodeRunStatus
from worker.agents.code.agent import (
    CodeAgent,
    CodeContext,
    CodeOutput,
)
from worker.lib.code_persistence import persist_turn, set_run_status
from worker.lib.llm_routing import resolve_llm_provider


__all__ = [
    "CanvasLanguage",
    "ClientFeedback",
    "CodeRunParams",
    "CodeRunStatus",
    "PersistedTurn",
    "analyze_feedback_activity",
    "finalize_code_run_activity",
    "generate_code_activity",
]


CanvasLanguage = Literal["python", "javascript", "html", "react"]


@dataclass(frozen=True)
class CodeRunParams:
    """Identity + prompt envelope shared across both activities.

    ``byok_key_handle`` is plumbed through for hosted billing routing
    but ignored today (see ``llm_routing.resolve_llm_provider``).
    """

    run_id: str
    note_id: str
    workspace_id: str
    user_id: str
    prompt: str
    language: CanvasLanguage
    byok_key_handle: Optional[str]


@dataclass(frozen=True)
class PersistedTurn:
    """Compact view of a previously-saved ``code_turns`` row.

    The workflow keeps the canonical history list and passes it into each
    activity invocation so the LLM can see the prior source / explanation
    when computing a fix.
    """

    seq: int
    kind: Literal["generate", "fix"]
    source: str
    explanation: str
    prev_error: Optional[str]


@dataclass(frozen=True)
class ClientFeedback:
    """Browser-sandbox execution result reported back via signal.

    ``kind="ok"`` means the run produced no error; ``kind="error"``
    carries the captured exception/message and the trailing stdout the
    LLM uses to diagnose.
    """

    kind: Literal["ok", "error"]
    error: Optional[str] = None
    stdout: Optional[str] = None


@activity.defn
async def generate_code_activity(
    params: CodeRunParams,
    history: list[PersistedTurn],
) -> CodeOutput:
    """First turn — synthesize source from the user's prompt.

    The activity flips ``code_runs.status`` to ``running`` on entry and
    ``awaiting_feedback`` once the turn is persisted, so the workflow
    can sleep on a signal without an extra round-trip.
    """
    activity.heartbeat("starting generate")
    await set_run_status(params.run_id, "running")
    provider = await resolve_llm_provider(
        user_id=params.user_id,
        workspace_id=params.workspace_id,
        purpose="chat",
        byok_key_handle=params.byok_key_handle,
    )
    agent = CodeAgent(llm=provider)
    ctx = CodeContext(
        kind="generate",
        user_prompt=params.prompt,
        language=params.language,
        last_code=None,
        last_error=None,
        stdout_tail="",
    )
    try:
        out = await agent.run(ctx)
        await persist_turn(
            run_id=params.run_id,
            seq=len(history),
            kind="generate",
            source=out.source,
            explanation=out.explanation,
            prev_error=None,
        )
        await set_run_status(params.run_id, "awaiting_feedback")
    except Exception:
        try:
            await set_run_status(params.run_id, "failed")
        except Exception:
            pass  # status flip is best-effort; workflow will reconcile
        raise
    activity.heartbeat("generate done")
    return out


@activity.defn
async def analyze_feedback_activity(
    params: CodeRunParams,
    history: list[PersistedTurn],
    feedback: ClientFeedback,
) -> CodeOutput:
    """Subsequent turn — fix the previous source given the client error.

    ``history[-1]`` is the most recent persisted turn; its source is the
    code the user just ran, and ``feedback.error`` is the exception/stdout
    the sandbox surfaced. Both are forwarded into ``CodeContext`` so the
    fix prompt can quote them verbatim.
    """
    activity.heartbeat("starting fix")
    await set_run_status(params.run_id, "running")
    provider = await resolve_llm_provider(
        user_id=params.user_id,
        workspace_id=params.workspace_id,
        purpose="chat",
        byok_key_handle=params.byok_key_handle,
    )
    agent = CodeAgent(llm=provider)
    last = history[-1] if history else None
    ctx = CodeContext(
        kind="fix",
        user_prompt=params.prompt,
        language=params.language,
        last_code=last.source if last else "",
        last_error=feedback.error,
        stdout_tail=feedback.stdout or "",
    )
    try:
        out = await agent.run(ctx)
        await persist_turn(
            run_id=params.run_id,
            seq=len(history),
            kind="fix",
            source=out.source,
            explanation=out.explanation,
            prev_error=feedback.error,
        )
        await set_run_status(params.run_id, "awaiting_feedback")
    except Exception:
        try:
            await set_run_status(params.run_id, "failed")
        except Exception:
            pass  # status flip is best-effort; workflow will reconcile
        raise
    activity.heartbeat("fix done")
    return out


@activity.defn
async def finalize_code_run_activity(run_id: str, status: CodeRunStatus) -> None:
    """Persist the terminal workflow status after a signal-driven exit."""

    activity.heartbeat(f"finalizing {status}")
    await set_run_status(run_id, status)
