"""Metric calculation tests."""
from __future__ import annotations

from runtime.eval.case import EvalCase, ExpectedHandoff, ExpectedToolCall
from runtime.eval.metrics import score_trajectory
from runtime.events import AgentEnd, Handoff, ToolUse


def _tool_use(name: str, args: dict, seq: int = 0) -> ToolUse:
    return ToolUse(
        run_id="r", workspace_id="w", agent_name="a", seq=seq, ts=1.0,
        type="tool_use", tool_call_id=f"c{seq}", tool_name=name,
        input_args=args, input_hash="h", concurrency_safe=False,
    )


def _end(output: dict, seq: int = 99) -> AgentEnd:
    return AgentEnd(
        run_id="r", workspace_id="w", agent_name="a", seq=seq, ts=2.0,
        type="agent_end", output=output, duration_ms=100,
    )


def test_perfect_tool_trajectory() -> None:
    case = EvalCase(
        id="x", description="d", agent="research", scope="page", input={},
        expected_tools=[ExpectedToolCall(tool_name="search_pages", args_match={"scope": "page"})],
    )
    events = [_tool_use("search_pages", {"scope": "page"}), _end({"answer": "x"})]
    result = score_trajectory(case, events, total_cost_krw=50, duration_ms=500)
    assert result.tool_trajectory_score == 1.0
    assert result.forbidden_tool_score == 1.0


def test_forbidden_tool_penalizes() -> None:
    case = EvalCase(
        id="x", description="d", agent="research", scope="page", input={},
        forbidden_tools=["fetch_url"],
    )
    events = [_tool_use("fetch_url", {"url": "https://evil"}), _end({"answer": "x"})]
    result = score_trajectory(case, events, total_cost_krw=50, duration_ms=500)
    assert result.forbidden_tool_score == 0.0


def test_cost_over_budget() -> None:
    case = EvalCase(
        id="x", description="d", agent="research", scope="page", input={}, max_cost_krw=100
    )
    events = [_end({})]
    result = score_trajectory(case, events, total_cost_krw=200, duration_ms=500)
    assert result.cost_within_budget == 0.0


def test_response_contains() -> None:
    case = EvalCase(
        id="x", description="d", agent="research", scope="page", input={},
        response_contains=["알고리즘"],
    )
    events = [_end({"answer": "프로젝트에서 쓰인 알고리즘은 ..."})]
    result = score_trajectory(case, events, total_cost_krw=0, duration_ms=0)
    assert result.response_contains_score == 1.0


def test_missing_required_tool() -> None:
    case = EvalCase(
        id="x", description="d", agent="research", scope="page", input={},
        expected_tools=[ExpectedToolCall(tool_name="search_pages", required=True)],
    )
    events = [_end({})]
    result = score_trajectory(case, events, total_cost_krw=0, duration_ms=0)
    assert result.tool_trajectory_score == 0.0


def test_handoff_score() -> None:
    case = EvalCase(
        id="x", description="d", agent="compiler", scope="project", input={},
        expected_handoffs=[ExpectedHandoff(to_agent="research")],
    )
    events = [
        Handoff(
            run_id="r", workspace_id="w", agent_name="compiler", seq=0, ts=1.0,
            type="handoff", from_agent="compiler", to_agent="research",
            child_run_id="r2", scope="project", reason="needs search",
        ),
        _end({}),
    ]
    result = score_trajectory(case, events, total_cost_krw=0, duration_ms=0)
    assert result.handoff_score == 1.0
