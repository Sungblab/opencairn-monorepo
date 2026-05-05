from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from llm.tool_types import AssistantTurn, ToolUse, UsageCounts
from temporalio.testing import ActivityEnvironment

from worker.activities.code_workspace_repair import (
    CodeWorkspaceRepairError,
    build_patch_from_repair_output,
    plan_code_workspace_repair,
)
from worker.agents.code_workspace_repair.agent import (
    CodeWorkspaceRepairAgent,
    CodeWorkspaceRepairContext,
    CodeWorkspaceRepairOutput,
)


def _turn_with_emit(args: dict) -> AssistantTurn:
    return AssistantTurn(
        final_text=None,
        tool_uses=(
            ToolUse(
                id="t1",
                name="emit_code_workspace_repair",
                args=args,
            ),
        ),
        assistant_message=None,
        usage=UsageCounts(input_tokens=0, output_tokens=0),
        stop_reason="tool_use",
    )


@pytest.mark.asyncio
async def test_repair_agent_emits_structured_file_changes() -> None:
    llm = MagicMock()
    llm.generate_with_tools = AsyncMock(
        return_value=_turn_with_emit(
            {
                "summary": "Fix failing test",
                "files": [
                    {
                        "path": "src/App.tsx",
                        "content": "export const fixed = true;",
                    }
                ],
            }
        )
    )
    agent = CodeWorkspaceRepairAgent(llm=llm)

    out = await agent.run(
        CodeWorkspaceRepairContext(
            command="test",
            exit_code=1,
            logs=[{"stream": "stderr", "text": "tests failed"}],
            manifest={
                "entries": [
                    {
                        "path": "src/App.tsx",
                        "kind": "file",
                        "contentHash": "sha256:old",
                        "inlineContent": "export const broken;",
                    }
                ]
            },
        )
    )

    assert isinstance(out, CodeWorkspaceRepairOutput)
    assert out.summary == "Fix failing test"
    assert out.files[0]["path"] == "src/App.tsx"


def test_build_patch_from_repair_output_computes_hashes_and_preview() -> None:
    patch = build_patch_from_repair_output(
        {
            "codeWorkspaceId": "00000000-0000-4000-8000-000000000020",
            "snapshotId": "00000000-0000-4000-8000-000000000021",
            "manifest": {
                "entries": [
                    {
                        "path": "src/App.tsx",
                        "kind": "file",
                        "contentHash": "sha256:old",
                        "inlineContent": "export const broken;",
                    }
                ]
            },
        },
        CodeWorkspaceRepairOutput(
            summary="Repair failing test",
            files=[
                {
                    "path": "src/App.tsx",
                    "content": "export const fixed = true;",
                }
            ],
        ),
    )

    assert patch["codeWorkspaceId"] == "00000000-0000-4000-8000-000000000020"
    assert patch["baseSnapshotId"] == "00000000-0000-4000-8000-000000000021"
    assert patch["operations"] == [
            {
                "op": "update",
                "path": "src/App.tsx",
                "beforeHash": "sha256:old",
                "afterHash": (
                    "sha256:"
                    "1f7a6f36ebcb06bd4b5ce22043953f05a84c91378a05d6cf4439c9bf5aeb5e61"
                ),
                "inlineContent": "export const fixed = true;",
            }
        ]
    assert patch["preview"] == {
        "filesChanged": 1,
        "additions": 1,
        "deletions": 1,
        "summary": "Repair failing test",
    }


def test_build_patch_rejects_traversal_paths() -> None:
    with pytest.raises(CodeWorkspaceRepairError, match="code_workspace_path_traversal"):
        build_patch_from_repair_output(
            {
                "codeWorkspaceId": "00000000-0000-4000-8000-000000000020",
                "snapshotId": "00000000-0000-4000-8000-000000000021",
                "manifest": {"entries": []},
            },
            CodeWorkspaceRepairOutput(
                summary="bad",
                files=[{"path": "../secret.txt", "content": "x"}],
            ),
        )


@pytest.mark.asyncio
async def test_plan_code_workspace_repair_activity_uses_llm_and_returns_patch() -> None:
    llm = MagicMock()
    llm.generate_with_tools = AsyncMock(
        return_value=_turn_with_emit(
            {
                "summary": "Fix failing test",
                "files": [{"path": "src/App.tsx", "content": "fixed"}],
            }
        )
    )

    with patch(
        "worker.activities.code_workspace_repair.resolve_llm_provider",
        new=AsyncMock(return_value=llm),
    ):
        env = ActivityEnvironment()
        patch_payload = await env.run(
            plan_code_workspace_repair,
            {
                "workspaceId": "00000000-0000-4000-8000-000000000001",
                "actorUserId": "user-1",
                "codeWorkspaceId": "00000000-0000-4000-8000-000000000020",
                "snapshotId": "00000000-0000-4000-8000-000000000021",
                "command": "test",
                "exitCode": 1,
                "logs": [{"stream": "stderr", "text": "tests failed"}],
                "manifest": {
                    "entries": [
                        {
                            "path": "src/App.tsx",
                            "kind": "file",
                            "contentHash": "sha256:old",
                            "inlineContent": "broken",
                        }
                    ]
                },
            }
        )

    assert patch_payload["operations"][0]["path"] == "src/App.tsx"
    assert patch_payload["operations"][0]["op"] == "update"
