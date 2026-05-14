from __future__ import annotations

from worker.tools_builtin import BUILTIN_TOOLS


def test_builtin_tools_has_expected_tools():
    names = {t.name for t in BUILTIN_TOOLS}
    assert names == {
        "list_project_topics",
        "search_concepts",
        "search_notes",
        "read_note",
        "fetch_url",
        "emit_structured_output",
        "get_concept_graph",
        "literature_search",
        "literature_import",
    }


def test_all_tools_have_descriptions():
    for t in BUILTIN_TOOLS:
        assert t.description, f"{t.name} has empty description"


def test_all_tools_support_input_schema():
    for t in BUILTIN_TOOLS:
        schema = t.input_schema()
        assert schema["type"] == "object"
        assert "properties" in schema
