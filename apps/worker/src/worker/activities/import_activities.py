"""Source-agnostic import orchestration activities.

These sit above the source-specific activities from Tasks 6-8 and drive the
shape of an import job end-to-end:

* ``resolve_target``        — pick or create the landing project; locks its id
                              onto the import_jobs row so the UI can link to it.
* ``materialize_page_tree`` — insert ``notes`` rows for every page node, return
                              an ``idx → note_id`` map the Markdown converter
                              uses to rewrite wiki-links and the binary upload
                              activity uses to pick its effective parent page.
* ``finalize_import_job``   — compute the terminal status (completed/failed),
                              stamp finishedAt, and kick a best-effort
                              notification row.

The hard work (tree traversal, ancestor lookup) is in two pure helpers below
— they're what the unit tests pin down. The activity bodies are thin HTTP
envelopes over ``worker.lib.api_client`` so the workflow-level test in
Task 10 can black-box them via httpx fixtures.
"""
from __future__ import annotations

import contextlib
import datetime as dt
from typing import Any

from temporalio import activity

from worker.lib.api_client import get_internal, patch_internal, post_internal


def _sort_pages_first(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return ``nodes`` reordered so every ``page`` precedes every ``binary``,
    preserving original ``idx`` order within each group.

    Stable on the ``idx`` tiebreaker matters: the workflow iterates the sorted
    list once and assumes note_ids for nested pages are already assigned by
    the time it reaches the binaries referencing them.
    """
    return sorted(
        nodes,
        key=lambda n: (0 if n["kind"] == "page" else 1, n["idx"]),
    )


def _compute_effective_parents(
    nodes: list[dict[str, Any]],
    idx_to_note_id: dict[int, str],
) -> dict[int, str]:
    """Map each binary node's idx → closest ancestor page's note_id.

    Binaries whose entire ancestor chain is other binaries (unusual — usually
    just means the tree walker emitted a file above any page, or the file
    sits at the root of a Drive-file-only import) are omitted from the map.
    The caller treats a missing entry as "anchor to the job's target parent".
    """
    by_idx = {n["idx"]: n for n in nodes}
    eff: dict[int, str] = {}
    for n in nodes:
        if n["kind"] != "binary":
            continue
        cur = n["parent_idx"]
        while cur is not None:
            parent = by_idx.get(cur)
            if parent is None:
                break
            if parent["kind"] == "page":
                note_id = idx_to_note_id.get(cur)
                if note_id is not None:
                    eff[n["idx"]] = note_id
                break
            cur = parent["parent_idx"]
    return eff


@activity.defn(name="resolve_target")
async def resolve_target(payload: dict[str, Any]) -> dict[str, Any]:
    """Ensure the import has a concrete project + parent to land in.

    Payload: ``{ job_id }``. For the ``new`` target kind we create a fresh
    project named after the import timestamp; for ``existing`` we just echo
    back what the caller saved on the job. Either way the job row is patched
    with ``targetProjectId`` + ``targetParentNoteId`` so subsequent activities
    can read it without re-doing the branch.
    """
    job_id = payload["job_id"]
    job = await get_internal(f"/api/internal/import-jobs/{job_id}")
    target = job["target"]

    if target["kind"] == "new":
        default_name = (
            f"Import {dt.datetime.now(dt.UTC):%Y-%m-%d %H:%M}"
        )
        project = await post_internal(
            "/api/internal/projects",
            {
                "workspaceId": job["workspaceId"],
                "userId": job["userId"],
                "name": default_name,
            },
        )
        await patch_internal(
            f"/api/internal/import-jobs/{job_id}",
            {
                "targetProjectId": project["id"],
                "targetParentNoteId": None,
            },
        )
        return {
            "project_id": project["id"],
            "parent_note_id": None,
        }

    return {
        "project_id": target["projectId"],
        "parent_note_id": target.get("parentNoteId"),
    }


@activity.defn(name="materialize_page_tree")
async def materialize_page_tree(payload: dict[str, Any]) -> dict[str, Any]:
    """Insert an empty note for each page node and return idx→note_id.

    Pages are created in sort order so nested children see their parent's
    note_id by the time they're inserted (useful when the notes schema
    grows a parent column; for now the current flat-hierarchy schema
    ignores the value). Binaries are NOT inserted here — the per-binary
    upload + ingest path owns their note creation.

    Payload: ``{ job_id, manifest, project_id, target_parent_note_id }``
    Returns ``{ idx_to_note_id, binary_effective_parent }`` with string
    keys so the Temporal JSON round-trip is lossless.
    """
    job_id = payload["job_id"]
    nodes: list[dict[str, Any]] = payload["manifest"]["nodes"]
    target_parent = payload.get("target_parent_note_id")
    project_id = payload["project_id"]

    idx_to_note_id: dict[int, str] = {}
    for n in _sort_pages_first(nodes):
        if n["kind"] != "page":
            continue
        parent_note = (
            idx_to_note_id.get(n["parent_idx"])
            if n["parent_idx"] is not None
            else target_parent
        )
        resp = await post_internal(
            "/api/internal/notes",
            {
                "projectId": project_id,
                "parentNoteId": parent_note,  # accepted, flat for MVP
                "title": n["display_name"],
                "type": "note",
                "content": None,
                "importJobId": job_id,
                "importPath": n["path"],
            },
        )
        idx_to_note_id[n["idx"]] = resp["id"]

    effective_parents = _compute_effective_parents(nodes, idx_to_note_id)

    # Total item count on the job row surfaces progress early — the UI
    # shows "0 of N" as soon as materialization finishes, before any
    # binary ingest runs.
    await patch_internal(
        f"/api/internal/import-jobs/{job_id}",
        {"totalItems": len(nodes)},
    )

    return {
        "idx_to_note_id": {str(k): v for k, v in idx_to_note_id.items()},
        "binary_effective_parent": {
            str(k): v for k, v in effective_parents.items()
        },
    }


_SOURCE_LABELS_KO = {
    "google_drive": "Google Drive",
    "notion_zip": "Notion",
}


def _build_import_summary(
    *,
    source: str,
    status: str,
    completed: int,
    failed: int,
    total: int,
) -> tuple[str, str]:
    """Return (summary, level) for the system-kind notification.

    Korean default — the project ships ko-first and ``users`` doesn't track
    a preferred locale yet. The drawer renders ``payload.summary`` raw for
    ``system`` kind so a per-locale string here is a clean future swap.
    """
    label = _SOURCE_LABELS_KO.get(source, "가져오기")
    if status == "completed":
        if failed == 0:
            return (
                f"{label} 가져오기가 완료되었습니다 — {completed}/{total} 페이지",
                "info",
            )
        return (
            f"{label} 가져오기 — {completed}/{total} 성공, {failed}개 실패",
            "warning",
        )
    return (
        f"{label} 가져오기에 실패했습니다 — {total}개 항목 모두 실패",
        "warning",
    )


@activity.defn(name="finalize_import_job")
async def finalize_import_job(payload: dict[str, Any]) -> None:
    """Stamp the terminal status + counters on the import_jobs row.

    Status rule: anything with at least one success is ``completed`` (partial
    failure is still a useful outcome — user gets what ingested). A run with
    zero successes and at least one failure flips to ``failed`` so the UI
    can show an error banner instead of a green check.
    """
    job_id = payload["job_id"]
    completed = int(payload["completed_items"])
    failed = int(payload["failed_items"])
    total = int(payload["total_items"])

    status = (
        "failed"
        if (total > 0 and completed == 0 and failed > 0)
        else "completed"
    )

    await patch_internal(
        f"/api/internal/import-jobs/{job_id}",
        {
            "status": status,
            "completedItems": completed,
            "failedItems": failed,
            "errorSummary": payload.get("error_summary"),
            "finishedAt": dt.datetime.now(dt.UTC).isoformat(),
        },
    )

    # Notification is best-effort — a missing endpoint or DB blip must not
    # surface as a job failure, since the import itself has already landed.
    # The previous code shipped `kind: "import_done"`, which is *not* in
    # `notification_kind` — every publish was a silent 400. Use `system`
    # with a refType/refId tag so the drawer can route on click later.
    with contextlib.suppress(Exception):
        # Re-fetch the job to learn the source kind for a nicer summary —
        # the workflow envelope drops `source` by the time we get here.
        job = await get_internal(f"/api/internal/import-jobs/{job_id}")
        summary, level = _build_import_summary(
            source=str(job.get("source", "")),
            status=status,
            completed=completed,
            failed=failed,
            total=total,
        )
        await post_internal(
            "/api/internal/notifications",
            {
                "userId": payload["user_id"],
                "kind": "system",
                "payload": {
                    "summary": summary,
                    "level": level,
                    "refType": "import_job",
                    "refId": job_id,
                },
            },
        )


__all__ = [
    "_build_import_summary",
    "_compute_effective_parents",
    "_sort_pages_first",
    "finalize_import_job",
    "materialize_page_tree",
    "resolve_target",
]
