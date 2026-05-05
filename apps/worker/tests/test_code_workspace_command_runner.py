from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from worker.activities.code_workspace_command import (
    CodeWorkspaceCommandError,
    DockerCodeWorkspaceCommandExecutor,
    create_default_code_command_executor,
    run_code_workspace_command,
)

if TYPE_CHECKING:
    from pathlib import Path


class RecordingExecutor:
    def __init__(self, *, exit_code: int = 0) -> None:
        self.exit_code = exit_code
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
            "durationMs": 25,
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
            "-lc",
            "corepack enable pnpm >/dev/null 2>&1 || true; pnpm run test --if-present",
        ]
    ]


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
