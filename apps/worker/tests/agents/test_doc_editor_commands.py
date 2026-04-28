"""Plan 11B Phase A - CommandSpec registry sanity."""
from __future__ import annotations

import pytest

from worker.agents.doc_editor.commands import COMMANDS, get_command_spec
from worker.agents.doc_editor.commands.spec import CommandSpec


def test_registry_lists_v1_commands():
    assert sorted(COMMANDS.keys()) == ["expand", "improve", "summarize", "translate"]


def test_each_spec_has_required_fields():
    for name, spec in COMMANDS.items():
        assert isinstance(spec, CommandSpec)
        assert spec.name == name
        assert spec.system_prompt.strip(), f"{name} has empty prompt"
        assert spec.output_mode == "diff"


def test_get_command_spec_unknown_raises():
    with pytest.raises(KeyError):
        get_command_spec("cite")  # Phase B
