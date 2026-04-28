"""Plan 11B Phase A - CommandSpec registry sanity."""
from __future__ import annotations

import pytest

from worker.agents.doc_editor.commands import COMMANDS, get_command_spec
from worker.agents.doc_editor.commands.spec import CommandSpec


def test_registry_lists_v2_commands():
    assert sorted(COMMANDS.keys()) == [
        "cite",
        "expand",
        "factcheck",
        "improve",
        "summarize",
        "translate",
    ]


def test_each_spec_has_required_fields():
    for name, spec in COMMANDS.items():
        assert isinstance(spec, CommandSpec)
        assert spec.name == name
        assert spec.system_prompt.strip(), f"{name} has empty prompt"
        assert spec.output_mode in ("diff", "comment")


def test_get_command_spec_unknown_raises():
    with pytest.raises(KeyError):
        get_command_spec("outline")


def test_phase_a_specs_have_empty_tools_tuple():
    for name in ("improve", "translate", "summarize", "expand"):
        assert COMMANDS[name].tools == ()


def test_rag_specs_use_search_notes_tool():
    assert COMMANDS["cite"].output_mode == "diff"
    assert COMMANDS["factcheck"].output_mode == "comment"
    for name in ("cite", "factcheck"):
        assert "search_notes" in COMMANDS[name].tools
        assert "emit_structured_output" in COMMANDS[name].tools
