from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest

from worker.activities.code_workspace_install import (
    CodeWorkspaceInstallError,
    DockerCodeWorkspaceInstallExecutor,
    create_default_code_install_executor,
    notify_code_workspace_install_result_activity,
    run_code_workspace_install,
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
            "stdout": "install passed" if self.exit_code == 0 else "",
            "stderr": "" if self.exit_code == 0 else "install failed",
            "durationMs": 25,
        }


@pytest.mark.asyncio
async def test_installs_packages_against_inline_manifest() -> None:
    executor = RecordingExecutor()

    result = await run_code_workspace_install(
        {
            "codeWorkspaceId": "00000000-0000-4000-8000-000000000001",
            "snapshotId": "00000000-0000-4000-8000-000000000002",
            "packageManager": "pnpm",
            "packages": [
                {"name": "@vitejs/plugin-react", "dev": True},
                {"name": "zod", "version": "3.25.0", "dev": False},
            ],
            "timeoutMs": 120_000,
            "manifest": {
                "entries": [
                    {
                        "path": "package.json",
                        "kind": "file",
                        "bytes": 32,
                        "contentHash": "sha256:pkg",
                        "inlineContent": "{\"dependencies\":{}}",
                    },
                ]
            },
        },
        executor=executor,
    )

    assert executor.calls == [
        {
            "argv": [
                "pnpm",
                "add",
                "zod@3.25.0",
                "--save-prod",
                "@vitejs/plugin-react",
                "--save-dev",
            ],
            "timeout_ms": 120_000,
            "files": {"package.json": "{\"dependencies\":{}}"},
        }
    ]
    assert result == {
        "ok": True,
        "codeWorkspaceId": "00000000-0000-4000-8000-000000000001",
        "snapshotId": "00000000-0000-4000-8000-000000000002",
        "packageManager": "pnpm",
        "installed": [
            {"name": "@vitejs/plugin-react", "dev": True},
            {"name": "zod", "version": "3.25.0", "dev": False},
        ],
        "exitCode": 0,
        "durationMs": 25,
        "logs": [{"stream": "stdout", "text": "install passed"}],
    }


@pytest.mark.asyncio
async def test_rejects_unknown_package_manager_before_materializing() -> None:
    executor = RecordingExecutor()

    with pytest.raises(CodeWorkspaceInstallError, match="package_manager_not_approved"):
        await run_code_workspace_install(
            {
                "codeWorkspaceId": "00000000-0000-4000-8000-000000000001",
                "snapshotId": "00000000-0000-4000-8000-000000000002",
                "packageManager": "curl",
                "packages": [{"name": "zod"}],
                "manifest": {"entries": []},
            },
            executor=executor,
        )

    assert executor.calls == []


@pytest.mark.asyncio
async def test_notifies_internal_api_with_install_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    async def fake_post_internal(path: str, body: dict[str, Any]) -> dict[str, Any]:
        calls.append({"path": path, "body": body})
        return {"ok": True}

    monkeypatch.setattr(
        "worker.activities.code_workspace_install.post_internal",
        fake_post_internal,
    )

    result = {
        "ok": True,
        "codeWorkspaceId": "00000000-0000-4000-8000-000000000020",
        "snapshotId": "00000000-0000-4000-8000-000000000021",
        "packageManager": "pnpm",
        "installed": [{"name": "zod", "dev": False}],
        "exitCode": 0,
        "logs": [{"stream": "stdout", "text": "install passed"}],
    }
    response = await notify_code_workspace_install_result_activity(
        {
            "actionId": "00000000-0000-4000-8000-000000000010",
            "requestId": "00000000-0000-4000-8000-000000000011",
            "workspaceId": "00000000-0000-4000-8000-000000000001",
            "projectId": "00000000-0000-4000-8000-000000000002",
            "actorUserId": "user-1",
        },
        result,
        "code-workspace-install-00000000-0000-4000-8000-000000000010",
    )

    assert response == {"ok": True}
    assert calls == [
        {
            "path": "/api/internal/agent-actions/code-install-results",
            "body": {
                "actionId": "00000000-0000-4000-8000-000000000010",
                "requestId": "00000000-0000-4000-8000-000000000011",
                "workflowId": "code-workspace-install-00000000-0000-4000-8000-000000000010",
                "workspaceId": "00000000-0000-4000-8000-000000000001",
                "projectId": "00000000-0000-4000-8000-000000000002",
                "userId": "user-1",
                "result": result,
            },
        }
    ]


@pytest.mark.asyncio
async def test_selects_docker_executor_only_when_explicitly_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CODE_WORKSPACE_INSTALL_EXECUTOR", raising=False)
    with pytest.raises(CodeWorkspaceInstallError, match="code_install_executor_unavailable"):
        create_default_code_install_executor()

    monkeypatch.setenv("CODE_WORKSPACE_INSTALL_EXECUTOR", "docker")
    assert isinstance(create_default_code_install_executor(), DockerCodeWorkspaceInstallExecutor)


@pytest.mark.asyncio
async def test_docker_executor_uses_networked_bounded_container(tmp_path: Path) -> None:
    calls: list[list[str]] = []

    class FakeProcess:
        returncode = 0

        async def communicate(self) -> tuple[bytes, bytes]:
            return b"install passed", b""

    async def fake_process_factory(*argv: str, **_: Any) -> FakeProcess:
        calls.append(list(argv))
        return FakeProcess()

    executor = DockerCodeWorkspaceInstallExecutor(process_factory=fake_process_factory)
    result = await executor(
        argv=["pnpm", "add", "zod"],
        cwd=tmp_path,
        timeout_ms=120_000,
    )

    assert result == {
        "exitCode": 0,
        "stdout": "install passed",
        "stderr": "",
    }
    assert calls == [
        [
            "docker",
            "run",
            "--rm",
            "--network",
            "bridge",
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
            "corepack enable pnpm >/dev/null 2>&1 || true; pnpm add zod",
        ]
    ]
