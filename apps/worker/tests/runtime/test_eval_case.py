"""EvalCase model + loader tests."""
from __future__ import annotations

from pathlib import Path

import yaml

from runtime.eval.case import EvalCase, ExpectedToolCall
from runtime.eval.loader import load_case_file


def test_eval_case_defaults() -> None:
    c = EvalCase(id="x", description="d", agent="research", scope="page", input={})
    assert c.max_cost_krw == 1000
    assert c.expected_tools == []
    assert c.forbidden_tools == []


def test_expected_tool_call_partial_match() -> None:
    t = ExpectedToolCall(tool_name="search_pages", args_match={"scope": "page"})
    assert t.args_match == {"scope": "page"}


def test_load_yaml_case(tmp_path: Path) -> None:
    f = tmp_path / "c.yaml"
    f.write_text(yaml.safe_dump({
        "id": "r1",
        "description": "sample",
        "agent": "research",
        "scope": "page",
        "input": {"query": "x"},
        "expected_tools": [{"tool_name": "search_pages"}],
    }))
    c = load_case_file(f)
    assert c.id == "r1"
    assert len(c.expected_tools) == 1
