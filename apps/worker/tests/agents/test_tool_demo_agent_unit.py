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


async def test_full_run_unions_mcp_tools_when_enabled(monkeypatch):
    calls = {}

    async def fake_build(user_id, *, db_session, on_warning=None):
        calls["user_id"] = user_id
        calls["db_session"] = db_session
        return ["mcp-tool"]

    async def fake_run_with_tools(**kwargs):
        calls["tools"] = kwargs["tools"]
        return "ok"

    monkeypatch.setenv("FEATURE_MCP_CLIENT", "true")
    monkeypatch.setattr(
        "worker.agents.tool_demo.agent.build_mcp_tools_for_user",
        fake_build,
    )
    monkeypatch.setattr("worker.agents.tool_demo.agent.run_with_tools", fake_run_with_tools)

    out = await ToolDemoAgent.full(provider=None).run(
        user_prompt="hi",
        tool_context={
            "workspace_id": "ws",
            "project_id": None,
            "page_id": None,
            "user_id": "user-1",
            "run_id": "run",
            "scope": "workspace",
        },
        db_session=object(),
    )

    assert out == "ok"
    assert calls["user_id"] == "user-1"
    assert calls["tools"][-1] == "mcp-tool"
