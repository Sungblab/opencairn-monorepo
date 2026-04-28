#!/usr/bin/env python
"""Fail if apps/worker/src/worker/agents/**/*.py imports langgraph or langchain_core.

We don't depend on those packages anymore — agents must build on the local
``runtime`` facade (Plan 12 + Agent Runtime v2 Sub-A). This guard catches
accidental reintroductions before they hit a Docker build. Architectural
decision: ``docs/architecture/agent-platform-roadmap.md`` §A5.
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

FORBIDDEN_MODULES = {"langgraph", "langchain_core", "langchain"}
AGENTS_DIR = Path(__file__).parent.parent / "src" / "worker" / "agents"


def check_file(path: Path) -> list[str]:
    violations: list[str] = []
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError as e:
        return [f"{path}: syntax error {e}"]
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in FORBIDDEN_MODULES:
                    violations.append(
                        f"{path}:{node.lineno}: direct import of {alias.name} "
                        f"-- use `from runtime import ...`"
                    )
        elif isinstance(node, ast.ImportFrom) and node.module:
            root = node.module.split(".")[0]
            if root in FORBIDDEN_MODULES:
                violations.append(
                    f"{path}:{node.lineno}: direct import from {node.module} "
                    f"-- use `from runtime import ...`"
                )
    return violations


def main() -> int:
    if not AGENTS_DIR.exists():
        print(f"agents dir {AGENTS_DIR} does not exist -- skipping (Plan 4 hasn't run yet)")
        return 0
    all_violations: list[str] = []
    for py in AGENTS_DIR.rglob("*.py"):
        all_violations.extend(check_file(py))
    if all_violations:
        print("Import boundary violations:")
        for v in all_violations:
            print(f"  {v}")
        return 1
    print("OK -- no direct langgraph/langchain imports in agents/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
