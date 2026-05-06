from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

import pytest

from worker.activities.code_workspace_command import (
    CodeWorkspaceCommandError,
    DockerCodeWorkspaceCommandExecutor,
    create_default_code_command_executor,
    notify_code_workspace_command_result_activity,
    run_code_workspace_command,
)

if TYPE_CHECKING:
    from pathlib import Path


class RecordingExecutor:
    def __init__(self, *, exit_code: int = 0, duration_ms: int | None = 25) -> None:
        self.exit_code = exit_code
        self.duration_ms = duration_ms
        self.calls: list[dict[str, Any]] = []

    async def __call__(
        self,
        *,
        argv: list[str],
        cwd: Path,
        timeout_ms: int,
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "argv": argv,
                "timeout_ms": timeout_ms,
                "files": {
                    path.relative_to(cwd).as_posix(): path.read_text(encoding="utf-8")
                    for path in cwd.rglob("*")
                    if path.is_file()
                },
            }
        )
        return {
            "exitCode": self.exit_code,
            "stdout": "tests passed" if self.exit_code == 0 else "",
            "stderr": "" if self.exit_code == 0 else "tests failed",
            **({} if self.duration_ms is None else {"durationMs": self.duration_ms}),
        }


@pytest.mark.asyncio
async def test_runs_approved_command_against_inline_manifest() -> None:
    executor = RecordingExecutor()

    result = await run_code_workspace_command(
        {
            "codeWorkspaceId": "00000000-0000-4000-8000-000000000001",
            "snapshotId": "00000000-0000-4000-8000-000000000002",
            "command": "test",
            "timeoutMs": 30_000,
            "manifest": {
                "entries": [
                    {"path": "src", "kind": "directory"},
                    {
                        "path": "package.json",
                        "kind": "file",
                        "bytes": 32,
                        "contentHash": "sha256:pkg",
                        "inlineContent": "{\"scripts\":{\"test\":\"vitest\"}}",
                    },
                    {
                        "path": "src/App.tsx",
                        "kind": "file",
                        "bytes": 16,
                        "contentHash": "sha256:app",
                        "inlineContent": "export {};",
                    },
                ]
            },
        },
        executor=executor,
    )

    assert executor.calls == [
        {
            "argv": ["pnpm", "run", "test", "--if-present"],
            "timeout_ms": 30_000,
            "files": {
                "package.json": "{\"scripts\":{\"test\":\"vitest\"}}",
                "src/App.tsx": "export {};",
            },
        }
    ]
    assert result == {
        "ok": True,
        "codeWorkspaceId": "00000000-0000-4000-8000-000000000001",
        "snapshotId": "00000000-0000-4000-8000-000000000002",
        "command": "test",
        "exitCode": 0,
        "durationMs": 25,
        "logs": [{"stream": "stdout", "text": "tests passed"}],
    }


@pytest.mark.asyncio
async def test_preserves_explicit_zero_duration_from_executor() -> None:
    result = await run_code_workspace_command(
        {
            "codeWorkspaceId": "00000000-0000-4000-8000-000000000001",
            "snapshotId": "00000000-0000-4000-8000-000000000002",
            "command": "lint",
            "manifest": {"entries": []},
        },
        executor=RecordingExecutor(duration_ms=0),
    )

    assert result["durationMs"] == 0


@pytest.mark.asyncio
async def test_rejects_unapproved_command_before_materializing() -> None:
    executor = RecordingExecutor()

    with pytest.raises(CodeWorkspaceCommandError, match="code_command_not_approved"):
        await run_code_workspace_command(
            {
                "codeWorkspaceId": "00000000-0000-4000-8000-000000000001",
                "snapshotId": "00000000-0000-4000-8000-000000000002",
                "command": "install",
                "manifest": {"entries": []},
            },
            executor=executor,
        )

    assert executor.calls == []


@pytest.mark.asyncio
async def test_selects_docker_executor_only_when_explicitly_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CODE_WORKSPACE_COMMAND_EXECUTOR", raising=False)
    with pytest.raises(CodeWorkspaceCommandError, match="code_command_executor_unavailable"):
        create_default_code_command_executor()

    monkeypatch.setenv("CODE_WORKSPACE_COMMAND_EXECUTOR", "docker")
    assert isinstance(create_default_code_command_executor(), DockerCodeWorkspaceCommandExecutor)


@pytest.mark.asyncio
async def test_docker_executor_uses_networkless_bounded_container(tmp_path: Path) -> None:
    calls: list[list[str]] = []

    class FakeProcess:
        returncode = 0

        async def communicate(self) -> tuple[bytes, bytes]:
            return b"tests passed", b""

    async def fake_process_factory(*argv: str, **_: Any) -> FakeProcess:
        calls.append(list(argv))
        return FakeProcess()

    executor = DockerCodeWorkspaceCommandExecutor(process_factory=fake_process_factory)
    result = await executor(
        argv=["pnpm", "run", "test", "--if-present"],
        cwd=tmp_path,
        timeout_ms=30_000,
    )

    assert result == {
        "exitCode": 0,
        "stdout": "tests passed",
        "stderr": "",
    }
    assert calls == [
        [
            "docker",
            "run",
            "--rm",
            "--network",
            "none",
            "--cpus",
            "1",
            "--memory",
            "512m",
            "-v",
            f"{tmp_path.resolve()}:/workspace:rw",
            "-w",
            "/workspace",
            "node:20-alpine",
            "sh",
            "-c",
            "corepack enable pnpm >/dev/null 2>&1 || true; pnpm run test --if-present",
        ]
    ]


@pytest.mark.asyncio
async def test_docker_executor_reaps_process_after_timeout(tmp_path: Path) -> None:
    events: list[str] = []

    class SlowProcess:
        returncode = None

        async def communicate(self) -> tuple[bytes, bytes]:
            await asyncio.sleep(1)
            return b"", b""

        def kill(self) -> None:
            events.append("kill")

        async def wait(self) -> None:
            events.append("wait")

    async def fake_process_factory(*_: str, **__: Any) -> SlowProcess:
        return SlowProcess()

    executor = DockerCodeWorkspaceCommandExecutor(process_factory=fake_process_factory)

    with pytest.raises(CodeWorkspaceCommandError, match="code_command_timeout"):
        await executor(argv=["pnpm", "run", "test"], cwd=tmp_path, timeout_ms=1)

    assert events == ["kill", "wait"]


@pytest.mark.asyncio
async def test_docker_executor_wraps_process_start_failures(tmp_path: Path) -> None:
    async def fake_process_factory(*_: str, **__: Any) -> Any:
        raise OSError("docker unavailable")

    executor = DockerCodeWorkspaceCommandExecutor(process_factory=fake_process_factory)

    with pytest.raises(CodeWorkspaceCommandError, match="code_command_executor_failed"):
        await executor(argv=["pnpm", "run", "test"], cwd=tmp_path, timeout_ms=30_000)


@pytest.mark.asyncio
async def test_rejects_traversal_and_object_hydration_gaps() -> None:
    executor = RecordingExecutor()

    with pytest.raises(CodeWorkspaceCommandError, match="code_workspace_path_traversal"):
        await run_code_workspace_command(
            {
                "codeWorkspaceId": "00000000-0000-4000-8000-000000000001",
                "snapshotId": "00000000-0000-4000-8000-000000000002",
                "command": "lint",
                "manifest": {
                    "entries": [
                        {
                            "path": "../secret.txt",
                            "kind": "file",
                            "bytes": 1,
                            "contentHash": "sha256:x",
                            "inlineContent": "x",
                        }
                    ]
                },
            },
            executor=executor,
        )

    with pytest.raises(CodeWorkspaceCommandError, match="code_workspace_object_hydration_required"):
        await run_code_workspace_command(
            {
                "codeWorkspaceId": "00000000-0000-4000-8000-000000000001",
                "snapshotId": "00000000-0000-4000-8000-000000000002",
                "command": "build",
                "manifest": {
                    "entries": [
                        {
                            "path": "src/App.tsx",
                            "kind": "file",
                            "bytes": 1,
                            "contentHash": "sha256:x",
                            "objectKey": "code-workspaces/app/src/App.tsx",
                        }
                    ]
                },
            },
            executor=executor,
        )

    assert executor.calls == []


@pytest.mark.asyncio
async def test_rejects_unbounded_raw_manifests_before_materializing() -> None:
    executor = RecordingExecutor()

    with pytest.raises(CodeWorkspaceCommandError, match="code_workspace_manifest_entries_exceeded"):
        await run_code_workspace_command(
            {
                "codeWorkspaceId": "00000000-0000-4000-8000-000000000001",
                "snapshotId": "00000000-0000-4000-8000-000000000002",
                "command": "lint",
                "manifest": {
                    "entries": [
                        {"path": f"file-{index}.ts", "kind": "directory"}
                        for index in range(2001)
                    ]
                },
            },
            executor=executor,
        )

    with pytest.raises(CodeWorkspaceCommandError, match="code_workspace_path_depth_exceeded"):
        await run_code_workspace_command(
            {
                "codeWorkspaceId": "00000000-0000-4000-8000-000000000001",
                "snapshotId": "00000000-0000-4000-8000-000000000002",
                "command": "lint",
                "manifest": {
                    "entries": [
                        {
                            "path": "/".join(f"d{index}" for index in range(17)),
                            "kind": "directory",
                        }
                    ]
                },
            },
            executor=executor,
        )

    with pytest.raises(CodeWorkspaceCommandError, match="code_workspace_path_invalid"):
        await run_code_workspace_command(
            {
                "codeWorkspaceId": "00000000-0000-4000-8000-000000000001",
                "snapshotId": "00000000-0000-4000-8000-000000000002",
                "command": "lint",
                "manifest": {
                    "entries": [
                        {
                            "path": "C:relative/path.ts",
                            "kind": "directory",
                        }
                    ]
                },
            },
            executor=executor,
        )

    assert executor.calls == []


@pytest.mark.asyncio
async def test_notifies_internal_api_with_command_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    async def fake_post_internal(path: str, body: dict[str, Any]) -> dict[str, Any]:
        calls.append({"path": path, "body": body})
        return {"ok": True}

    monkeypatch.setattr(
        "worker.activities.code_workspace_command.post_internal",
        fake_post_internal,
    )

    result = {
        "ok": True,
        "codeWorkspaceId": "00000000-0000-4000-8000-000000000020",
        "snapshotId": "00000000-0000-4000-8000-000000000021",
        "command": "test",
        "exitCode": 0,
        "logs": [{"stream": "stdout", "text": "tests passed"}],
    }
    response = await notify_code_workspace_command_result_activity(
        {
            "actionId": "00000000-0000-4000-8000-000000000010",
            "requestId": "00000000-0000-4000-8000-000000000011",
            "workspaceId": "00000000-0000-4000-8000-000000000001",
            "projectId": "00000000-0000-4000-8000-000000000002",
            "actorUserId": "user-1",
        },
        result,
        "code-workspace-command-00000000-0000-4000-8000-000000000010",
    )

    assert response == {"ok": True}
    assert calls == [
        {
            "path": "/api/internal/agent-actions/code-command-results",
            "body": {
                "actionId": "00000000-0000-4000-8000-000000000010",
                "requestId": "00000000-0000-4000-8000-000000000011",
                "workflowId": "code-workspace-command-00000000-0000-4000-8000-000000000010",
                "workspaceId": "00000000-0000-4000-8000-000000000001",
                "projectId": "00000000-0000-4000-8000-000000000002",
                "userId": "user-1",
                "result": result,
            },
        }
    ]
