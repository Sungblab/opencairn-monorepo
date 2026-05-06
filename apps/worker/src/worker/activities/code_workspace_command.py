"""Approved Code Workspace command runner foundation.

This module materializes an inline code workspace snapshot into a temporary
directory and delegates the actual process execution to an injected executor.
The production default intentionally refuses to execute: unrestricted server-side
commands are out of scope until a real sandbox executor is wired in.
"""

from __future__ import annotations

import os
import shlex
import tempfile
from asyncio import create_subprocess_exec, wait_for
from collections.abc import Awaitable, Callable
from inspect import isawaitable
from pathlib import Path, PurePosixPath
from subprocess import PIPE
from time import monotonic
from typing import Any

from temporalio import activity

from worker.lib.api_client import post_internal

CODE_WORKSPACE_MAX_DEPTH = 16
CODE_WORKSPACE_MAX_ENTRIES = 2000
CODE_WORKSPACE_MAX_PATH_LENGTH = 512

APPROVED_COMMANDS: dict[str, list[str]] = {
    "lint": ["pnpm", "run", "lint", "--if-present"],
    "test": ["pnpm", "run", "test", "--if-present"],
    "build": ["pnpm", "run", "build", "--if-present"],
}

CommandExecutor = Callable[..., Awaitable[dict[str, Any]]]
ProcessFactory = Callable[..., Awaitable[Any]]


class CodeWorkspaceCommandError(RuntimeError):
    """Raised for contract or sandbox-readiness failures."""


class DockerCodeWorkspaceCommandExecutor:
    """Run approved commands inside a networkless Docker container."""

    def __init__(
        self,
        *,
        image: str = "node:20-alpine",
        cpus: str = "1",
        memory: str = "512m",
        process_factory: ProcessFactory = create_subprocess_exec,
    ) -> None:
        self.image = image
        self.cpus = cpus
        self.memory = memory
        self.process_factory = process_factory

    async def __call__(
        self,
        *,
        argv: list[str],
        cwd: Path,
        timeout_ms: int,
    ) -> dict[str, Any]:
        command = _container_shell_command(argv)
        docker_argv = [
            "docker",
            "run",
            "--rm",
            "--network",
            "none",
            "--cpus",
            self.cpus,
            "--memory",
            self.memory,
            "-v",
            f"{cwd.resolve()}:/workspace:rw",
            "-w",
            "/workspace",
            self.image,
            "sh",
            "-c",
            command,
        ]
        try:
            process = await self.process_factory(*docker_argv, stdout=PIPE, stderr=PIPE)
        except OSError as exc:
            raise CodeWorkspaceCommandError("code_command_executor_failed") from exc
        try:
            stdout_bytes, stderr_bytes = await wait_for(
                process.communicate(),
                timeout=timeout_ms / 1000,
            )
        except TimeoutError as exc:
            kill = getattr(process, "kill", None)
            if callable(kill):
                kill()
            wait = getattr(process, "wait", None)
            if callable(wait):
                wait_result = wait()
                if isawaitable(wait_result):
                    await wait_result
            raise CodeWorkspaceCommandError("code_command_timeout") from exc
        return {
            "exitCode": int(process.returncode),
            "stdout": _decode_output(stdout_bytes),
            "stderr": _decode_output(stderr_bytes),
        }


async def run_code_workspace_command(
    request: dict[str, Any],
    *,
    executor: CommandExecutor | None = None,
) -> dict[str, Any]:
    """Run an approved command against an inline code workspace manifest.

    The Temporal activity registration uses the default executor, which is
    unavailable by design. Tests and future sandbox wiring inject an executor
    that is responsible for the actual isolation boundary.
    """

    command = _require_str(request, "command")
    argv = APPROVED_COMMANDS.get(command)
    if argv is None:
        raise CodeWorkspaceCommandError("code_command_not_approved")

    code_workspace_id = _require_str(request, "codeWorkspaceId")
    snapshot_id = _require_str(request, "snapshotId")
    timeout_ms = int(request.get("timeoutMs") or 60_000)
    if timeout_ms < 1_000 or timeout_ms > 300_000:
        raise CodeWorkspaceCommandError("code_command_timeout_out_of_bounds")

    runner = executor or create_default_code_command_executor()
    start = monotonic()
    with tempfile.TemporaryDirectory(prefix="opencairn-code-workspace-") as tmp:
        root = Path(tmp).resolve()
        _materialize_manifest(root, request.get("manifest"))
        raw = await runner(argv=list(argv), cwd=root, timeout_ms=timeout_ms)

    exit_code = int(raw.get("exitCode", 1))
    duration_ms_raw = raw.get("durationMs")
    duration_ms = (
        int(duration_ms_raw)
        if duration_ms_raw is not None
        else int((monotonic() - start) * 1000)
    )
    logs = _logs_from_executor(raw)
    return {
        "ok": exit_code == 0,
        "codeWorkspaceId": code_workspace_id,
        "snapshotId": snapshot_id,
        "command": command,
        "exitCode": exit_code,
        "durationMs": duration_ms,
        "logs": logs,
    }


@activity.defn(name="run_code_workspace_command")
async def run_code_workspace_command_activity(request: dict[str, Any]) -> dict[str, Any]:
    return await run_code_workspace_command(request)


@activity.defn(name="notify_code_workspace_command_result")
async def notify_code_workspace_command_result_activity(
    request: dict[str, Any],
    result: dict[str, Any],
    workflow_id: str,
) -> dict[str, Any]:
    return await post_internal(
        "/api/internal/agent-actions/code-command-results",
        {
            "actionId": _require_str(request, "actionId"),
            "requestId": _require_str(request, "requestId"),
            "workflowId": workflow_id,
            "workspaceId": _require_str(request, "workspaceId"),
            "projectId": _require_str(request, "projectId"),
            "userId": _require_str(request, "actorUserId"),
            "result": result,
        },
    )


async def _unavailable_executor(*, argv: list[str], cwd: Path, timeout_ms: int) -> dict[str, Any]:
    raise CodeWorkspaceCommandError("code_command_executor_unavailable")


def create_default_code_command_executor() -> CommandExecutor:
    configured = os.environ.get("CODE_WORKSPACE_COMMAND_EXECUTOR", "").strip().lower()
    if configured == "docker":
        return DockerCodeWorkspaceCommandExecutor()
    raise CodeWorkspaceCommandError("code_command_executor_unavailable")


def _materialize_manifest(root: Path, manifest: Any) -> None:
    if not isinstance(manifest, dict):
        raise CodeWorkspaceCommandError("code_workspace_manifest_required")
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        raise CodeWorkspaceCommandError("code_workspace_manifest_entries_required")
    if len(entries) > CODE_WORKSPACE_MAX_ENTRIES:
        raise CodeWorkspaceCommandError("code_workspace_manifest_entries_exceeded")

    for entry in entries:
        if not isinstance(entry, dict):
            raise CodeWorkspaceCommandError("code_workspace_manifest_entry_invalid")
        target = _safe_target(root, _require_str(entry, "path"))
        kind = _require_str(entry, "kind")
        if kind == "directory":
            target.mkdir(parents=True, exist_ok=True)
            continue
        if kind != "file":
            raise CodeWorkspaceCommandError("code_workspace_manifest_entry_kind_invalid")
        if "inlineContent" not in entry:
            raise CodeWorkspaceCommandError("code_workspace_object_hydration_required")
        inline = entry["inlineContent"]
        if not isinstance(inline, str):
            raise CodeWorkspaceCommandError("code_workspace_inline_content_invalid")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(inline, encoding="utf-8")


def _safe_target(root: Path, raw_path: str) -> Path:
    stripped = raw_path.strip()
    path = PurePosixPath(stripped)
    if not stripped or path.is_absolute():
        raise CodeWorkspaceCommandError("code_workspace_path_invalid")
    if len(stripped) > CODE_WORKSPACE_MAX_PATH_LENGTH:
        raise CodeWorkspaceCommandError("code_workspace_path_length_exceeded")
    if any(part in {"", ".", ".."} for part in path.parts):
        raise CodeWorkspaceCommandError("code_workspace_path_traversal")
    if len(path.parts) > CODE_WORKSPACE_MAX_DEPTH:
        raise CodeWorkspaceCommandError("code_workspace_path_depth_exceeded")
    if "\\" in raw_path or _has_windows_drive(raw_path):
        raise CodeWorkspaceCommandError("code_workspace_path_invalid")

    target = (root / Path(*path.parts)).resolve()
    root_text = str(root)
    target_text = str(target)
    if target_text != root_text and not target_text.startswith(root_text + os.sep):
        raise CodeWorkspaceCommandError("code_workspace_path_traversal")
    return target


def _has_windows_drive(path: str) -> bool:
    return len(path) >= 2 and path[1] == ":" and path[0].isalpha()


def _container_shell_command(argv: list[str]) -> str:
    command = " ".join(shlex.quote(part) for part in argv)
    return f"corepack enable pnpm >/dev/null 2>&1 || true; {command}"


def _logs_from_executor(raw: dict[str, Any]) -> list[dict[str, str]]:
    logs: list[dict[str, str]] = []
    stdout = raw.get("stdout")
    stderr = raw.get("stderr")
    if isinstance(stdout, str) and stdout:
        logs.append({"stream": "stdout", "text": stdout[-64 * 1024 :]})
    if isinstance(stderr, str) and stderr:
        logs.append({"stream": "stderr", "text": stderr[-64 * 1024 :]})
    if not logs:
        logs.append({"stream": "system", "text": "command completed without output"})
    return logs


def _decode_output(value: bytes | str) -> str:
    if isinstance(value, str):
        return value
    return value.decode("utf-8", errors="replace")


def _require_str(value: dict[str, Any], field: str) -> str:
    raw = value.get(field)
    if not isinstance(raw, str) or not raw.strip():
        raise CodeWorkspaceCommandError(f"{field}_required")
    return raw.strip()
