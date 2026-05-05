"""Code workspace repair planner activity."""

from __future__ import annotations

import difflib
import hashlib
from pathlib import PurePosixPath
from typing import Any

from temporalio import activity

from worker.agents.code_workspace_repair.agent import (
    CodeWorkspaceRepairAgent,
    CodeWorkspaceRepairContext,
    CodeWorkspaceRepairOutput,
)
from worker.lib.llm_routing import resolve_llm_provider


class CodeWorkspaceRepairError(RuntimeError):
    """Raised for invalid repair planner inputs or outputs."""


@activity.defn(name="plan_code_workspace_repair")
async def plan_code_workspace_repair(request: dict[str, Any]) -> dict[str, Any]:
    activity.heartbeat("starting code workspace repair")
    provider = await resolve_llm_provider(
        user_id=_require_str(request, "actorUserId"),
        workspace_id=_require_str(request, "workspaceId"),
        purpose="chat",
        byok_key_handle=None,
    )
    agent = CodeWorkspaceRepairAgent(llm=provider)
    output = await agent.run(
        CodeWorkspaceRepairContext(
            command=_require_str(request, "command"),
            exit_code=int(request.get("exitCode") or 1),
            logs=_require_logs(request.get("logs")),
            manifest=_require_manifest(request.get("manifest")),
        )
    )
    activity.heartbeat("code workspace repair planned")
    return build_patch_from_repair_output(request, output)


def build_patch_from_repair_output(
    request: dict[str, Any],
    output: CodeWorkspaceRepairOutput,
) -> dict[str, Any]:
    code_workspace_id = _require_str(request, "codeWorkspaceId")
    snapshot_id = _require_str(request, "snapshotId")
    manifest = _require_manifest(request.get("manifest"))
    existing = _file_entries_by_path(manifest)
    operations: list[dict[str, Any]] = []
    additions = 0
    deletions = 0

    for item in output.files:
        path = _normalise_path(item.get("path", ""))
        content = item.get("content")
        if not isinstance(content, str):
            raise CodeWorkspaceRepairError("code_workspace_repair_content_invalid")
        before = existing.get(path)
        after_hash = _sha256(content)
        if before is None:
            operations.append(
                {
                    "op": "create",
                    "path": path,
                    "afterHash": after_hash,
                    "inlineContent": content,
                }
            )
            additions += max(1, len(content.splitlines()))
            continue

        before_content = before.get("inlineContent")
        if not isinstance(before_content, str):
            raise CodeWorkspaceRepairError("code_workspace_object_hydration_required")
        if before_content == content:
            continue
        before_hash = before.get("contentHash")
        if not isinstance(before_hash, str) or not before_hash.strip():
            raise CodeWorkspaceRepairError("code_workspace_content_hash_required")
        add, delete = _line_delta(before_content, content)
        additions += add
        deletions += delete
        operations.append(
            {
                "op": "update",
                "path": path,
                "beforeHash": before_hash,
                "afterHash": after_hash,
                "inlineContent": content,
            }
        )

    if not operations:
        raise CodeWorkspaceRepairError("code_workspace_repair_empty_patch")

    return {
        "codeWorkspaceId": code_workspace_id,
        "baseSnapshotId": snapshot_id,
        "operations": operations,
        "preview": {
            "filesChanged": len(operations),
            "additions": additions,
            "deletions": deletions,
            "summary": output.summary.strip() or "Repair code workspace failure",
        },
    }


def _file_entries_by_path(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        raise CodeWorkspaceRepairError("code_workspace_manifest_entries_required")
    result: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("kind") != "file":
            continue
        path = _normalise_path(str(entry.get("path") or ""))
        result[path] = entry
    return result


def _normalise_path(raw_path: str) -> str:
    path = PurePosixPath(raw_path.strip())
    if not raw_path.strip() or path.is_absolute():
        raise CodeWorkspaceRepairError("code_workspace_path_invalid")
    if any(part in {"", ".", ".."} for part in path.parts):
        raise CodeWorkspaceRepairError("code_workspace_path_traversal")
    if "\\" in raw_path or _has_windows_drive(raw_path):
        raise CodeWorkspaceRepairError("code_workspace_path_invalid")
    return path.as_posix()


def _line_delta(before: str, after: str) -> tuple[int, int]:
    additions = 0
    deletions = 0
    for line in difflib.ndiff(before.splitlines(), after.splitlines()):
        if line.startswith("+ "):
            additions += 1
        elif line.startswith("- "):
            deletions += 1
    return additions, deletions


def _sha256(content: str) -> str:
    return "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest()


def _require_str(value: dict[str, Any], field: str) -> str:
    raw = value.get(field)
    if not isinstance(raw, str) or not raw.strip():
        raise CodeWorkspaceRepairError(f"{field}_required")
    return raw.strip()


def _require_logs(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise CodeWorkspaceRepairError("code_workspace_repair_logs_required")
    return [item for item in value if isinstance(item, dict)]


def _require_manifest(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CodeWorkspaceRepairError("code_workspace_manifest_required")
    return value


def _has_windows_drive(path: str) -> bool:
    return len(path) >= 3 and path[1] == ":" and path[0].isalpha() and path[2] in {"/", "\\"}
