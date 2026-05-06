"""Approved Code Workspace dependency install runner foundation.

This module mirrors the command runner foundation but keeps dependency install
execution behind a separate opt-in executor. Installs require network access, so
the production default refuses to run until operators explicitly configure the
Docker-backed executor.
"""

from __future__ import annotations

import os
import shlex
import tempfile
from asyncio import create_subprocess_exec, wait_for
from collections.abc import Awaitable, Callable
from pathlib import Path, PurePosixPath
from subprocess import PIPE
from time import monotonic
from typing import Any

from temporalio import activity

from worker.lib.api_client import post_internal

APPROVED_PACKAGE_MANAGERS = {"pnpm", "npm", "yarn"}

InstallExecutor = Callable[..., Awaitable[dict[str, Any]]]
ProcessFactory = Callable[..., Awaitable[Any]]


class CodeWorkspaceInstallError(RuntimeError):
    """Raised for contract or sandbox-readiness failures."""


class DockerCodeWorkspaceInstallExecutor:
    """Run approved dependency installs inside a bounded networked container."""

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
            "bridge",
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
            "-lc",
            command,
        ]
        process = await self.process_factory(*docker_argv, stdout=PIPE, stderr=PIPE)
        try:
            stdout_bytes, stderr_bytes = await wait_for(
                process.communicate(),
                timeout=timeout_ms / 1000,
            )
        except TimeoutError as exc:
            kill = getattr(process, "kill", None)
            if callable(kill):
                kill()
            raise CodeWorkspaceInstallError("code_install_timeout") from exc
        return {
            "exitCode": int(process.returncode),
            "stdout": _decode_output(stdout_bytes),
            "stderr": _decode_output(stderr_bytes),
        }


async def run_code_workspace_install(
    request: dict[str, Any],
    *,
    executor: InstallExecutor | None = None,
) -> dict[str, Any]:
    package_manager = _require_str(request, "packageManager")
    if package_manager not in APPROVED_PACKAGE_MANAGERS:
        raise CodeWorkspaceInstallError("package_manager_not_approved")

    code_workspace_id = _require_str(request, "codeWorkspaceId")
    snapshot_id = _require_str(request, "snapshotId")
    timeout_ms = int(request.get("timeoutMs") or 120_000)
    if timeout_ms < 1_000 or timeout_ms > 300_000:
        raise CodeWorkspaceInstallError("code_install_timeout_out_of_bounds")

    packages = _require_packages(request.get("packages"))
    argv = _install_argv(package_manager, packages)
    runner = executor or create_default_code_install_executor()
    start = monotonic()
    with tempfile.TemporaryDirectory(prefix="opencairn-code-install-") as tmp:
        root = Path(tmp).resolve()
        _materialize_manifest(root, request.get("manifest"))
        raw = await runner(argv=argv, cwd=root, timeout_ms=timeout_ms)

    exit_code = int(raw.get("exitCode", 1))
    duration_ms = int(raw.get("durationMs") or ((monotonic() - start) * 1000))
    return {
        "ok": exit_code == 0,
        "codeWorkspaceId": code_workspace_id,
        "snapshotId": snapshot_id,
        "packageManager": package_manager,
        "installed": packages,
        "exitCode": exit_code,
        "durationMs": duration_ms,
        "logs": _logs_from_executor(raw),
    }


@activity.defn(name="run_code_workspace_install")
async def run_code_workspace_install_activity(request: dict[str, Any]) -> dict[str, Any]:
    return await run_code_workspace_install(request)


@activity.defn(name="notify_code_workspace_install_result")
async def notify_code_workspace_install_result_activity(
    request: dict[str, Any],
    result: dict[str, Any],
    workflow_id: str,
) -> dict[str, Any]:
    return await post_internal(
        "/api/internal/agent-actions/code-install-results",
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


def create_default_code_install_executor() -> InstallExecutor:
    configured = os.environ.get("CODE_WORKSPACE_INSTALL_EXECUTOR", "").strip().lower()
    if configured == "docker":
        return DockerCodeWorkspaceInstallExecutor()
    raise CodeWorkspaceInstallError("code_install_executor_unavailable")


def _install_argv(package_manager: str, packages: list[dict[str, Any]]) -> list[str]:
    prod = [_package_spec(pkg) for pkg in packages if not pkg.get("dev")]
    dev = [_package_spec(pkg) for pkg in packages if pkg.get("dev")]
    if package_manager == "pnpm":
        argv = ["pnpm", "add"]
        if prod:
            argv.extend([*prod, "--save-prod"])
        if dev:
            argv.extend([*dev, "--save-dev"])
        return argv
    if package_manager == "npm":
        argv = ["npm", "install"]
        if prod:
            argv.extend([*prod, "--save-prod"])
        if dev:
            argv.extend([*dev, "--save-dev"])
        return argv
    argv = ["yarn", "add"]
    if prod:
        argv.extend(prod)
    if dev:
        argv.extend(["--dev", *dev])
    return argv


def _package_spec(pkg: dict[str, Any]) -> str:
    name = _require_str(pkg, "name")
    version = pkg.get("version")
    if isinstance(version, str) and version.strip():
        return f"{name}@{version.strip()}"
    return name


def _require_packages(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise CodeWorkspaceInstallError("packages_required")
    packages: list[dict[str, Any]] = []
    for pkg in value:
        if not isinstance(pkg, dict):
            raise CodeWorkspaceInstallError("package_invalid")
        normalized = {
            "name": _require_str(pkg, "name"),
            "dev": bool(pkg.get("dev", False)),
        }
        version = pkg.get("version")
        if isinstance(version, str) and version.strip():
            normalized["version"] = version.strip()
        packages.append(normalized)
    return packages


def _materialize_manifest(root: Path, manifest: Any) -> None:
    if not isinstance(manifest, dict):
        raise CodeWorkspaceInstallError("code_workspace_manifest_required")
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        raise CodeWorkspaceInstallError("code_workspace_manifest_entries_required")

    for entry in entries:
        if not isinstance(entry, dict):
            raise CodeWorkspaceInstallError("code_workspace_manifest_entry_invalid")
        target = _safe_target(root, _require_str(entry, "path"))
        kind = _require_str(entry, "kind")
        if kind == "directory":
            target.mkdir(parents=True, exist_ok=True)
            continue
        if kind != "file":
            raise CodeWorkspaceInstallError("code_workspace_manifest_entry_kind_invalid")
        if "inlineContent" not in entry:
            raise CodeWorkspaceInstallError("code_workspace_object_hydration_required")
        inline = entry["inlineContent"]
        if not isinstance(inline, str):
            raise CodeWorkspaceInstallError("code_workspace_inline_content_invalid")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(inline, encoding="utf-8")


def _safe_target(root: Path, raw_path: str) -> Path:
    path = PurePosixPath(raw_path.strip())
    if not raw_path.strip() or path.is_absolute():
        raise CodeWorkspaceInstallError("code_workspace_path_invalid")
    if any(part in {"", ".", ".."} for part in path.parts):
        raise CodeWorkspaceInstallError("code_workspace_path_traversal")
    if "\\" in raw_path or _has_windows_drive(raw_path):
        raise CodeWorkspaceInstallError("code_workspace_path_invalid")

    target = (root / Path(*path.parts)).resolve()
    root_text = str(root)
    target_text = str(target)
    if target_text != root_text and not target_text.startswith(root_text + os.sep):
        raise CodeWorkspaceInstallError("code_workspace_path_traversal")
    return target


def _has_windows_drive(path: str) -> bool:
    return len(path) >= 3 and path[1] == ":" and path[0].isalpha() and path[2] in {"/", "\\"}


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
        logs.append({"stream": "system", "text": "install completed without output"})
    return logs


def _decode_output(value: bytes | str) -> str:
    if isinstance(value, str):
        return value
    return value.decode("utf-8", errors="replace")


def _require_str(value: dict[str, Any], field: str) -> str:
    raw = value.get(field)
    if not isinstance(raw, str) or not raw.strip():
        raise CodeWorkspaceInstallError(f"{field}_required")
    return raw.strip()
