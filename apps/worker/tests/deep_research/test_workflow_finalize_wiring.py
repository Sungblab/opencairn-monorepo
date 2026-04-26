"""Static-analysis test that ``DeepResearchWorkflow.run`` calls
``finalize_deep_research`` before every terminal ``return`` (Plan 2C).

Why this exists: the canonical ``test_workflow.py`` end-to-end suite uses
``temporalio.testing.WorkflowEnvironment.start_time_skipping`` which
downloads + boots the Temporal test server. That step hangs in some
local-dev environments (Windows + restricted network) and the suite is
effectively only exercised in CI. A regression where someone adds a new
terminal ``return DeepResearchOutput(...)`` and forgets the matching
``workflow.execute_activity("finalize_deep_research", ...)`` would slip
past every local pre-push run silently.

This test parses the workflow source with ``ast`` and walks the
``DeepResearchWorkflow.run`` body. It asserts that every ``Return`` node
whose value is a ``DeepResearchOutput(...)`` call is preceded inside the
same enclosing block by an ``await workflow.execute_activity(
"finalize_deep_research", ...)`` call.

Module-level helpers ``_feature_disabled`` / ``_managed_disabled`` are
intentionally NOT covered: they return early before any run row exists
in the API, so calling finalize would 404. The inspection is scoped to
the workflow class body only.
"""
from __future__ import annotations

import ast
from pathlib import Path


WORKFLOW_FILE = (
    Path(__file__).resolve().parents[2]
    / "src"
    / "worker"
    / "workflows"
    / "deep_research_workflow.py"
)


def _is_finalize_activity_call(node: ast.AST) -> bool:
    """Return True if ``node`` is ``await workflow.execute_activity(
    "finalize_deep_research", ...)``."""
    if not isinstance(node, ast.Expr):
        return False
    inner = node.value
    if not isinstance(inner, ast.Await):
        return False
    call = inner.value
    if not isinstance(call, ast.Call):
        return False
    func = call.func
    if not (
        isinstance(func, ast.Attribute)
        and func.attr == "execute_activity"
        and isinstance(func.value, ast.Name)
        and func.value.id == "workflow"
    ):
        return False
    if not call.args:
        return False
    first = call.args[0]
    return isinstance(first, ast.Constant) and first.value == "finalize_deep_research"


def _is_deep_research_output_return(node: ast.AST) -> bool:
    """Return True if ``node`` is ``return DeepResearchOutput(...)``."""
    if not isinstance(node, ast.Return) or node.value is None:
        return False
    if not isinstance(node.value, ast.Call):
        return False
    callee = node.value.func
    return isinstance(callee, ast.Name) and callee.id == "DeepResearchOutput"


def _find_run_method(tree: ast.Module) -> ast.AsyncFunctionDef:
    for cls in tree.body:
        if isinstance(cls, ast.ClassDef) and cls.name == "DeepResearchWorkflow":
            for member in cls.body:
                if (
                    isinstance(member, ast.AsyncFunctionDef)
                    and member.name == "run"
                ):
                    return member
    raise AssertionError(
        "DeepResearchWorkflow.run not found — workflow file restructured?"
    )


def _walk_blocks(stmts: list[ast.stmt]) -> list[list[ast.stmt]]:
    """Yield each linear statement block reachable from ``stmts``.

    Each block is the unbroken statement list of a body — the function
    top-level body, an ``if`` / ``else`` body, a ``try`` body, an
    ``except`` handler body, a ``while`` body, and so on. Returning
    blocks separately mirrors how Python actually executes statements:
    a ``finalize`` call placed in an outer ``try`` body is NOT visible
    to a ``return`` inside an ``except`` handler, so they must be
    treated as distinct contexts.
    """
    out: list[list[ast.stmt]] = [stmts]
    for stmt in stmts:
        for field, value in ast.iter_fields(stmt):
            if isinstance(value, list) and value and isinstance(value[0], ast.stmt):
                out.extend(_walk_blocks(value))
            elif isinstance(value, ast.ExceptHandler):
                out.extend(_walk_blocks(value.body))
            elif (
                isinstance(value, list)
                and value
                and isinstance(value[0], ast.ExceptHandler)
            ):
                for handler in value:
                    out.extend(_walk_blocks(handler.body))
    return out


def test_every_terminal_return_has_finalize() -> None:
    source = WORKFLOW_FILE.read_text(encoding="utf-8")
    tree = ast.parse(source)
    run_method = _find_run_method(tree)

    blocks = _walk_blocks(run_method.body)
    return_count = 0
    for block in blocks:
        for idx, stmt in enumerate(block):
            if not _is_deep_research_output_return(stmt):
                continue
            return_count += 1
            preceding = block[:idx]
            has_finalize = any(_is_finalize_activity_call(s) for s in preceding)
            assert has_finalize, (
                f"DeepResearchOutput return at line {stmt.lineno} is not "
                "preceded by an await workflow.execute_activity("
                '"finalize_deep_research", ...) in the same block. Every '
                "terminal path must call finalize so the API stamps "
                "completedAt and (on completed) fires the "
                "research_complete notification."
            )

    # Sanity floor: the workflow has 5 active terminal paths today
    # (1 success + 1 failed + 3 cancelled). If the count drops below
    # that, somebody removed a return without removing finalize, and the
    # per-return assertion above wouldn't catch it.
    assert return_count >= 5, (
        f"Found only {return_count} DeepResearchOutput returns inside "
        "DeepResearchWorkflow.run; expected ≥ 5 (1 success + 1 failed + "
        "3 cancelled). Either a terminal path was removed or the "
        "AST walk missed a nested block — investigate before relaxing."
    )


def test_finalize_input_is_imported() -> None:
    """The workflow body cannot construct ``FinalizeInput`` without an
    import inside ``workflow.unsafe.imports_passed_through``. Catch a
    refactor that drops the import and silently breaks every finalize
    call at activity-dispatch time."""
    source = WORKFLOW_FILE.read_text(encoding="utf-8")
    assert (
        "from worker.activities.deep_research.finalize import FinalizeInput"
        in source
    ), (
        "FinalizeInput import missing from deep_research_workflow.py — "
        "the finalize activity calls construct FinalizeInput, so without "
        "this import (inside imports_passed_through) the workflow won't "
        "load."
    )
