"""Prompts for code workspace repair patch planning."""

from __future__ import annotations

from typing import Any

CODE_WORKSPACE_REPAIR_SYSTEM = """You are OpenCairn's code workspace repair agent.
You receive a bounded project snapshot and failed lint/test/build logs.
Return only the files that must change to repair the failure.
Do not request command execution, dependency installation, network access, or secrets.
Prefer the smallest patch that addresses the logged failure."""


def build_repair_prompt(
    *,
    command: str,
    exit_code: int,
    logs: list[dict[str, Any]],
    manifest: dict[str, Any],
) -> str:
    files = []
    for entry in manifest.get("entries", []):
        if not isinstance(entry, dict) or entry.get("kind") != "file":
            continue
        path = entry.get("path")
        content = entry.get("inlineContent")
        if isinstance(path, str) and isinstance(content, str):
            files.append(f"### {path}\n```\n{content[:12000]}\n```")
    log_text = "\n".join(
        f"[{item.get('stream', 'system')}] {item.get('text', '')}" for item in logs
    )[:16000]
    file_text = "\n\n".join(files)[:48000]
    return f"""Command: {command}
Exit code: {exit_code}

Logs:
{log_text}

Snapshot files:
{file_text}

Emit a concise repair summary and full replacement content for each changed file.
"""
