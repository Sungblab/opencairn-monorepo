"""Unit tests for the pure tree-walking helpers in import_activities.

The Temporal activity bodies themselves hit the internal HTTP API and are
exercised via the workflow-level test in Task 10. These helpers are pure
functions — easier to lock down here, and they own the data-shape decisions
the workflow depends on (binary → closest-ancestor-page, pages-first order).
"""
from __future__ import annotations

from worker.activities.import_activities import (
    _build_import_summary,
    _compute_effective_parents,
    _sort_pages_first,
)


def test_effective_parents_flat() -> None:
    # Two binaries hanging directly off the root page.
    nodes = [
        {"idx": 0, "parent_idx": None, "kind": "page"},
        {"idx": 1, "parent_idx": 0, "kind": "binary"},
        {"idx": 2, "parent_idx": 0, "kind": "binary"},
    ]
    idx_to_note = {0: "note-0"}
    eff = _compute_effective_parents(nodes, idx_to_note)
    assert eff == {1: "note-0", 2: "note-0"}


def test_effective_parents_nested_page() -> None:
    # Binary sits under a nested page → must anchor to that page, not root.
    nodes = [
        {"idx": 0, "parent_idx": None, "kind": "page"},
        {"idx": 1, "parent_idx": 0, "kind": "page"},
        {"idx": 2, "parent_idx": 1, "kind": "binary"},
    ]
    idx_to_note = {0: "note-0", 1: "note-1"}
    eff = _compute_effective_parents(nodes, idx_to_note)
    assert eff == {2: "note-1"}


def test_effective_parents_skips_intermediate_non_page() -> None:
    # If a binary's direct parent is another binary (rare — legacy shape),
    # we still walk up until we find a page.
    nodes = [
        {"idx": 0, "parent_idx": None, "kind": "page"},
        {"idx": 1, "parent_idx": 0, "kind": "binary"},
        {"idx": 2, "parent_idx": 1, "kind": "binary"},
    ]
    idx_to_note = {0: "note-0"}
    eff = _compute_effective_parents(nodes, idx_to_note)
    # Both binaries anchor to note-0 via ancestor walk.
    assert eff == {1: "note-0", 2: "note-0"}


def test_effective_parents_unresolvable() -> None:
    # Binary whose only ancestors are other binaries (no page anywhere in
    # the chain) must NOT appear in the map — the caller treats it as a
    # "no effective parent" case and falls back to the import's target
    # parent rather than crashing.
    nodes = [
        {"idx": 0, "parent_idx": None, "kind": "binary"},
        {"idx": 1, "parent_idx": 0, "kind": "binary"},
    ]
    eff = _compute_effective_parents(nodes, {})
    assert eff == {}


def test_sort_pages_first() -> None:
    # Pages must come out first so materialization can INSERT them in a
    # single pass with real note_ids available for children to reference.
    nodes = [
        {"idx": 0, "parent_idx": None, "kind": "binary"},
        {"idx": 1, "parent_idx": None, "kind": "page"},
        {"idx": 2, "parent_idx": 1, "kind": "binary"},
        {"idx": 3, "parent_idx": 1, "kind": "page"},
    ]
    sorted_ = _sort_pages_first(nodes)
    # All pages precede all binaries.
    kinds = [n["kind"] for n in sorted_]
    assert kinds == ["page", "page", "binary", "binary"]
    # Within a kind, original idx order is preserved — deterministic so the
    # workflow test can assert against a concrete sequence.
    assert sorted_[0]["idx"] == 1
    assert sorted_[1]["idx"] == 3


# ---------------------------------------------------------------------------
# _build_import_summary — drives the system-kind notification payload.
# Locked-down here so a copy tweak to the Korean string doesn't silently
# break the level (info/warning) classification that the drawer renders
# differently.
# ---------------------------------------------------------------------------


class TestBuildImportSummary:
    def test_full_success_is_info(self) -> None:
        summary, level = _build_import_summary(
            source="notion_zip",
            status="completed",
            completed=15,
            failed=0,
            total=15,
        )
        assert level == "info"
        assert "Notion" in summary
        assert "15/15" in summary

    def test_partial_success_is_warning(self) -> None:
        summary, level = _build_import_summary(
            source="google_drive",
            status="completed",
            completed=12,
            failed=3,
            total=15,
        )
        assert level == "warning"
        assert "Google Drive" in summary
        assert "12/15" in summary
        assert "3" in summary  # failure count surfaced

    def test_total_failure_is_warning(self) -> None:
        summary, level = _build_import_summary(
            source="notion_zip",
            status="failed",
            completed=0,
            failed=4,
            total=4,
        )
        assert level == "warning"
        assert "실패" in summary

    def test_unknown_source_uses_generic_label(self) -> None:
        summary, level = _build_import_summary(
            source="dropbox_zip",  # not a known source kind
            status="completed",
            completed=1,
            failed=0,
            total=1,
        )
        assert level == "info"
        # Falls back to the generic "가져오기" label rather than echoing the
        # raw source slug into a user-facing string.
        assert "dropbox_zip" not in summary
        assert "가져오기" in summary
