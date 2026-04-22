from __future__ import annotations

from worker.agents.tool_demo.agent import ToolDemoAgent


def test_plain_preset_has_no_tools():
    a = ToolDemoAgent.plain(provider=None)
    assert a.tools == ()


def test_reference_preset_is_retrieval_only():
    a = ToolDemoAgent.reference(provider=None)
    names = {t.name for t in a.tools}
    assert names == {
        "list_project_topics", "search_concepts",
        "search_notes", "read_note",
    }


def test_external_preset_has_fetch_and_emit():
    a = ToolDemoAgent.external(provider=None)
    names = {t.name for t in a.tools}
    assert names == {"fetch_url", "emit_structured_output"}


def test_full_preset_is_all_builtin():
    from worker.tools_builtin import BUILTIN_TOOLS
    a = ToolDemoAgent.full(provider=None)
    assert set(a.tools) == set(BUILTIN_TOOLS)
