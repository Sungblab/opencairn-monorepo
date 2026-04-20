"""AgentEvaluator — runs an Agent against an EvalCase and scores the trajectory."""
from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass

from runtime.agent import Agent
from runtime.eval.case import EvalCase
from runtime.eval.metrics import ScoreResult, score_trajectory
from runtime.events import AgentEnd, AgentError, AgentEvent, ModelEnd
from runtime.tools import ToolContext


DEFAULT_CRITERIA: dict[str, float] = {
    "tool_trajectory_score": 1.0,
    "forbidden_tool_score": 1.0,
    "handoff_score": 1.0,
    "response_contains_score": 0.8,
    "cost_within_budget": 1.0,
    "duration_within_budget": 1.0,
}


@dataclass
class EvalResult:
    case: EvalCase
    events: list[AgentEvent]
    scores: ScoreResult
    total_cost_krw: int
    duration_ms: int

    def assert_passed(self, criteria: dict[str, float]) -> None:
        failures: list[str] = []
        for key, threshold in criteria.items():
            actual = getattr(self.scores, key, None)
            if actual is None:
                failures.append(f"unknown metric: {key}")
                continue
            if actual < threshold:
                failures.append(f"{key}: {actual:.2f} < {threshold:.2f}")
        if failures:
            raise AssertionError(
                f"Eval case '{self.case.id}' failed:\n  " + "\n  ".join(failures)
            )


class AgentEvaluator:
    @staticmethod
    async def run(
        case: EvalCase,
        *,
        agent_factory: Callable[[], Agent],
        ctx_factory: Callable[[EvalCase], ToolContext] | None = None,
    ) -> EvalResult:
        agent = agent_factory()
        ctx = ctx_factory(case) if ctx_factory else _default_ctx(case)

        collected: list[AgentEvent] = []
        async for ev in agent.run(case.input, ctx):
            collected.append(ev)
            if isinstance(ev, AgentError):
                break

        total_cost = sum(e.cost_krw for e in collected if isinstance(e, ModelEnd))
        ends = [e for e in collected if isinstance(e, AgentEnd)]
        duration = ends[-1].duration_ms if ends else 0

        scores = score_trajectory(
            case, collected, total_cost_krw=total_cost, duration_ms=duration
        )
        return EvalResult(
            case=case, events=collected, scores=scores,
            total_cost_krw=total_cost, duration_ms=duration,
        )


def _default_ctx(case: EvalCase) -> ToolContext:
    async def _noop(_ev: AgentEvent) -> None:
        pass
    return ToolContext(
        workspace_id="eval-ws",
        project_id="eval-project" if case.scope in ("project", "page") else None,
        page_id="eval-page" if case.scope == "page" else None,
        user_id="eval-user",
        run_id=f"eval-{uuid.uuid4()}",
        scope=case.scope,
        emit=_noop,
    )


__all__ = ["AgentEvaluator", "DEFAULT_CRITERIA", "EvalResult"]
