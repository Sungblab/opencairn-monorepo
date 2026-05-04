from __future__ import annotations

from types import SimpleNamespace

from runtime.tool_policy import (
    PermissionBroker,
    ToolPolicy,
    get_tool_policy,
)


def test_default_policy_is_conservative_for_unmarked_tool() -> None:
    policy = get_tool_policy(SimpleNamespace(name="plain_tool"), {"q": "x"})

    assert policy.risk == "sensitive"
    assert policy.read_only is False


def test_broker_allows_read_tool_in_read_only_mode() -> None:
    broker = PermissionBroker(mode="read_only")
    read_tool = SimpleNamespace(name="search", read_only=True, risk="read")

    decision = broker.evaluate(read_tool, {"q": "x"}, context={"workspace_id": "ws"})

    assert decision.action == "allow"


def test_broker_denies_write_tool_in_read_only_mode() -> None:
    broker = PermissionBroker(mode="read_only")
    write_tool = SimpleNamespace(name="update_page", read_only=False, risk="write")

    decision = broker.evaluate(write_tool, {"title": "x"}, context={"workspace_id": "ws"})

    assert decision.action == "deny"
    assert "read_only" in decision.reason


def test_broker_requires_approval_for_write_tool_in_ask_mode() -> None:
    broker = PermissionBroker(mode="ask")
    write_tool = SimpleNamespace(name="update_page", read_only=False, risk="write")

    decision = broker.evaluate(write_tool, {"title": "x"}, context={"workspace_id": "ws"})

    assert decision.action == "needs_approval"


def test_broker_display_args_excludes_runtime_context_keys() -> None:
    broker = PermissionBroker(mode="ask")
    write_tool = SimpleNamespace(name="update_page", read_only=False, risk="write")

    decision = broker.evaluate(
        write_tool,
        {
            "title": "x",
            "workspace_id": "ws",
            "user_id": "u1",
            "emit": "internal-callable",
        },
        context={"workspace_id": "ws", "user_id": "u1", "emit": object()},
    )

    assert decision.display_args == {"title": "x"}


def test_dynamic_policy_receives_model_args() -> None:
    tool = SimpleNamespace(
        name="update_page",
        policy=lambda args: ToolPolicy(
            read_only=False,
            risk="write",
            resource=f"page:{args['page_id']}",
        ),
    )

    policy = get_tool_policy(tool, {"page_id": "p1"})

    assert policy.resource == "page:p1"


def test_policy_symbols_exported_from_runtime_package() -> None:
    from runtime import PermissionBroker as ExportedBroker
    from runtime import ToolPolicy as ExportedToolPolicy

    assert ExportedBroker is not None
    assert ExportedToolPolicy is not None
