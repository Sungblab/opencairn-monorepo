"""Trajectory scoring — tool match, forbidden, handoff, response, budgets."""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from runtime.events import AgentEnd, AgentEvent, Handoff, ToolUse

if TYPE_CHECKING:
    from runtime.eval.case import EvalCase, ExpectedToolCall


@dataclass
class ScoreResult:
    tool_trajectory_score: float
    forbidden_tool_score: float
    handoff_score: float
    response_contains_score: float
    cost_within_budget: float
    duration_within_budget: float


def _args_match(expected: ExpectedToolCall, actual: dict[str, Any]) -> bool:
    if expected.args_match is None:
        return True
    for k, v in expected.args_match.items():
        if k in expected.args_ignore:
            continue
        if actual.get(k) != v:
            return False
    return True


def score_trajectory(
    case: EvalCase,
    events: list[AgentEvent],
    *,
    total_cost_krw: int,
    duration_ms: int,
) -> ScoreResult:
    tool_uses = [e for e in events if isinstance(e, ToolUse)]
    handoffs = [e for e in events if isinstance(e, Handoff)]
    ends = [e for e in events if isinstance(e, AgentEnd)]

    required = [t for t in case.expected_tools if t.required]
    if not required:
        tool_score = 1.0
    else:
        hits = 0
        for exp in required:
            if any(
                u.tool_name == exp.tool_name and _args_match(exp, u.input_args) for u in tool_uses
            ):
                hits += 1
        tool_score = hits / len(required)

    if not case.forbidden_tools:
        forbidden_score = 1.0
    else:
        violated = any(u.tool_name in case.forbidden_tools for u in tool_uses)
        forbidden_score = 0.0 if violated else 1.0

    required_h = [h for h in case.expected_handoffs if h.required]
    if not required_h:
        handoff_score = 1.0
    else:
        hits = sum(
            1 for exp in required_h if any(h.to_agent == exp.to_agent for h in handoffs)
        )
        handoff_score = hits / len(required_h)

    if not case.response_contains:
        response_score = 1.0
    elif not ends:
        response_score = 0.0
    else:
        final_text = str(ends[-1].output)
        hits = sum(1 for sub in case.response_contains if sub in final_text)
        response_score = hits / len(case.response_contains)

    cost_score = 1.0 if total_cost_krw <= case.max_cost_krw else 0.0
    duration_score = 1.0 if duration_ms <= case.max_duration_ms else 0.0

    return ScoreResult(
        tool_trajectory_score=tool_score,
        forbidden_tool_score=forbidden_score,
        handoff_score=handoff_score,
        response_contains_score=response_score,
        cost_within_budget=cost_score,
        duration_within_budget=duration_score,
    )


__all__ = ["ScoreResult", "score_trajectory"]
