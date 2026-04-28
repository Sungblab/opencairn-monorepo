"""Plan 11B command registry."""
from __future__ import annotations

from worker.agents.doc_editor.commands import (
    cite,
    expand,
    factcheck,
    improve,
    summarize,
    translate,
)
from worker.agents.doc_editor.commands.spec import CommandSpec, OutputMode

COMMANDS: dict[str, CommandSpec] = {
    improve.SPEC.name: improve.SPEC,
    translate.SPEC.name: translate.SPEC,
    summarize.SPEC.name: summarize.SPEC,
    expand.SPEC.name: expand.SPEC,
    cite.SPEC.name: cite.SPEC,
    factcheck.SPEC.name: factcheck.SPEC,
}


def get_command_spec(name: str) -> CommandSpec:
    """Lookup helper. Raises KeyError on unknown commands; the agent's
    caller (the activity) catches that and surfaces a 400 to the API."""
    return COMMANDS[name]


__all__ = ["COMMANDS", "CommandSpec", "OutputMode", "get_command_spec"]
