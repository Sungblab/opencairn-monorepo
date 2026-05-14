"""Unit tests for :mod:`worker.lib.batch_timeouts`.

Plan 3b caller-side gap: compile_note + run_librarian activities declare
``start_to_close_timeout`` in their workflow modules. When
``BATCH_EMBED_*_ENABLED=true`` the activity blocks on a batch workflow
that legally runs for ``BATCH_EMBED_MAX_WAIT_SECONDS`` (default 24 h) —
the activity slot must outlast it. ``batch_submit.py:17`` documents this
requirement; this helper makes it enforceable from the workflow layer.
"""
from __future__ import annotations

from datetime import timedelta

import pytest

from worker.lib.batch_timeouts import batch_aware_start_timeout


class TestBatchAwareStartTimeout:
    def test_flag_off_returns_base_unchanged(self) -> None:
        base = timedelta(minutes=10)
        result = batch_aware_start_timeout(
            base,
            flag_env="BATCH_EMBED_COMPILER_ENABLED",
            env={},
        )
        assert result == base

    def test_flag_unset_equivalent_to_off(self) -> None:
        base = timedelta(minutes=10)
        result = batch_aware_start_timeout(
            base,
            flag_env="BATCH_EMBED_COMPILER_ENABLED",
            env={"UNRELATED": "true"},
        )
        assert result == base

    def test_flag_on_extends_short_base_to_accommodate_batch_wait(self) -> None:
        """Base 10 min vs 24 h batch wait + 10 min buffer → must grow."""
        base = timedelta(minutes=10)
        result = batch_aware_start_timeout(
            base,
            flag_env="BATCH_EMBED_COMPILER_ENABLED",
            env={"BATCH_EMBED_COMPILER_ENABLED": "true"},
        )
        # Default BATCH_EMBED_MAX_WAIT_SECONDS = 24h, +10min buffer.
        assert result >= timedelta(hours=24) + timedelta(minutes=10)

    def test_flag_on_preserves_larger_base(self) -> None:
        """If the caller already requested a larger timeout, don't shrink."""
        base = timedelta(hours=48)
        result = batch_aware_start_timeout(
            base,
            flag_env="BATCH_EMBED_COMPILER_ENABLED",
            env={
                "BATCH_EMBED_COMPILER_ENABLED": "true",
                "BATCH_EMBED_MAX_WAIT_SECONDS": str(60 * 60),  # 1h — way under base
            },
        )
        assert result == base

    def test_flag_on_honors_custom_max_wait(self) -> None:
        base = timedelta(minutes=10)
        result = batch_aware_start_timeout(
            base,
            flag_env="BATCH_EMBED_LIBRARIAN_ENABLED",
            env={
                "BATCH_EMBED_LIBRARIAN_ENABLED": "1",
                "BATCH_EMBED_MAX_WAIT_SECONDS": str(2 * 60 * 60),  # 2h
            },
        )
        # 2h + 10min buffer = 2h10m
        assert result == timedelta(hours=2) + timedelta(minutes=10)

    def test_flag_on_invalid_max_wait_falls_back_to_default(self) -> None:
        """Malformed env shouldn't shrink the timeout silently."""
        base = timedelta(minutes=10)
        result = batch_aware_start_timeout(
            base,
            flag_env="BATCH_EMBED_COMPILER_ENABLED",
            env={
                "BATCH_EMBED_COMPILER_ENABLED": "true",
                "BATCH_EMBED_MAX_WAIT_SECONDS": "not-a-number",
            },
        )
        assert result >= timedelta(hours=24) + timedelta(minutes=10)

    @pytest.mark.parametrize(
        "falsy", ["false", "False", "0", "no", "off", "", " "]
    )
    def test_flag_off_variants(self, falsy: str) -> None:
        base = timedelta(minutes=10)
        result = batch_aware_start_timeout(
            base,
            flag_env="BATCH_EMBED_COMPILER_ENABLED",
            env={"BATCH_EMBED_COMPILER_ENABLED": falsy},
        )
        assert result == base

    @pytest.mark.parametrize("truthy", ["true", "TRUE", "1", "yes", "on"])
    def test_flag_on_variants(self, truthy: str) -> None:
        base = timedelta(minutes=10)
        result = batch_aware_start_timeout(
            base,
            flag_env="BATCH_EMBED_COMPILER_ENABLED",
            env={"BATCH_EMBED_COMPILER_ENABLED": truthy},
        )
        assert result > base


class TestWorkflowModuleConstants:
    """Wiring checks: the workflow modules use the helper so the
    documented ``batch_submit.py:17`` invariant holds without developer
    attention. We read back the constants each workflow hands to
    ``workflow.execute_activity``.
    """

    def test_compile_note_timeout_covers_batch_wait_when_flag_on(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("BATCH_EMBED_COMPILER_ENABLED", "true")
        monkeypatch.delenv("BATCH_EMBED_MAX_WAIT_SECONDS", raising=False)

        # Force a fresh import so the module-level constant re-evaluates
        # with the patched env. importlib.reload would retain the old
        # module state, so we nuke and re-import.
        import importlib
        import sys

        sys.modules.pop("worker.workflows.compiler_workflow", None)
        cw = importlib.import_module("worker.workflows.compiler_workflow")

        assert timedelta(hours=24) + timedelta(
            minutes=10
        ) <= cw.COMPILE_NOTE_START_TIMEOUT

    def test_compile_note_timeout_stays_tight_when_flag_off(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("BATCH_EMBED_COMPILER_ENABLED", raising=False)

        import importlib
        import sys

        sys.modules.pop("worker.workflows.compiler_workflow", None)
        cw = importlib.import_module("worker.workflows.compiler_workflow")

        # With batch off, the original 10-minute envelope is preserved
        # — long-hanging compile activities should still be caught
        # quickly by Temporal's heartbeat watchdog.
        assert timedelta(minutes=10) == cw.COMPILE_NOTE_START_TIMEOUT

    def test_run_librarian_timeout_covers_batch_wait_when_flag_on(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("BATCH_EMBED_LIBRARIAN_ENABLED", "1")
        monkeypatch.delenv("BATCH_EMBED_MAX_WAIT_SECONDS", raising=False)

        import importlib
        import sys

        sys.modules.pop("worker.workflows.librarian_workflow", None)
        lw = importlib.import_module("worker.workflows.librarian_workflow")

        assert timedelta(hours=24) + timedelta(
            minutes=10
        ) <= lw.RUN_LIBRARIAN_START_TIMEOUT

    def test_run_librarian_timeout_stays_tight_when_flag_off(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("BATCH_EMBED_LIBRARIAN_ENABLED", raising=False)

        import importlib
        import sys

        sys.modules.pop("worker.workflows.librarian_workflow", None)
        lw = importlib.import_module("worker.workflows.librarian_workflow")

        assert timedelta(hours=1) == lw.RUN_LIBRARIAN_START_TIMEOUT
