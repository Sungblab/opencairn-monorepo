"""Hybrid import workflow — Notion ZIP fast-path + Drive fan-out.

Drives the end-to-end one-shot import flow:

1. resolve_target           — lock in the landing project
2. unzip_notion_export       (zip_object_key path)
   or discover_drive_tree    (drive file_ids/folder_ids path)
3. materialize_page_tree     — insert notes + collect idx→note_id
4. per-node fan-out:
      page    → convert_notion_md_to_plate (Notion only; Drive pages go
                through the IngestWorkflow as binaries and get their
                content built by the existing MIME-specific activity)
      binary  → upload_*_to_minio → child IngestWorkflow
5. finalize_import_job      — terminal status + counters
"""
from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    # IngestWorkflow is itself Temporal-deterministic, but importing it here
    # pulls in activity shims that touch stdlib os.environ. Temporal's sandbox
    # is strict about imports with side effects during workflow module load.
    from worker.workflows.ingest_workflow import IngestInput, IngestWorkflow


@dataclass
class ImportInput:
    """Input envelope for :class:`ImportWorkflow`.

    Stays source-agnostic — ``source`` picks the branch and
    ``source_metadata`` carries the payload each branch needs.
    """

    job_id: str
    user_id: str
    workspace_id: str
    source: str  # "google_drive" | "notion_zip"
    source_metadata: dict[str, Any]


_RETRY = RetryPolicy(maximum_attempts=3, backoff_coefficient=2.0)
_SHORT = timedelta(minutes=5)
_LONG = timedelta(minutes=30)


def _staging_base() -> str:
    """Mirror the activity's staging-dir resolution so the workflow can
    pass the correct path to convert_notion_md_to_plate. Overridable via
    NOTION_IMPORT_STAGING_DIR (default /var/opencairn/import-staging)."""
    return os.environ.get(
        "NOTION_IMPORT_STAGING_DIR", "/var/opencairn/import-staging"
    )


@workflow.defn(name="ImportWorkflow")
class ImportWorkflow:
    @workflow.run
    async def run(self, inp: ImportInput) -> dict[str, Any]:
        target = await workflow.execute_activity(
            "resolve_target",
            {"job_id": inp.job_id},
            schedule_to_close_timeout=_SHORT,
            retry_policy=_RETRY,
        )

        if inp.source == "notion_zip":
            manifest = await workflow.execute_activity(
                "unzip_notion_export",
                {
                    "job_id": inp.job_id,
                    "zip_object_key": inp.source_metadata["zip_object_key"],
                    "max_files": inp.source_metadata.get("max_files", 10_000),
                    # Default ceiling mirrors the upload endpoint's zod cap so
                    # a ZIP that survived upload also survives extraction.
                    "max_uncompressed": inp.source_metadata.get(
                        "max_uncompressed", 5 * 1024 * 1024 * 1024
                    ),
                },
                schedule_to_close_timeout=_LONG,
                retry_policy=_RETRY,
            )
        else:  # google_drive
            manifest = await workflow.execute_activity(
                "discover_drive_tree",
                {
                    "user_id": inp.user_id,
                    "workspace_id": inp.workspace_id,
                    "file_ids": inp.source_metadata.get("file_ids", []),
                    "folder_ids": inp.source_metadata.get("folder_ids", []),
                },
                schedule_to_close_timeout=_LONG,
                retry_policy=_RETRY,
            )

        maps = await workflow.execute_activity(
            "materialize_page_tree",
            {
                "job_id": inp.job_id,
                "manifest": manifest,
                "target_parent_note_id": target["parent_note_id"],
                "project_id": target["project_id"],
            },
            schedule_to_close_timeout=_LONG,
            retry_policy=_RETRY,
        )
        idx_to_note_id: dict[int, str] = {
            int(k): v for k, v in maps["idx_to_note_id"].items()
        }
        effective_parents: dict[int, str] = {
            int(k): v for k, v in maps["binary_effective_parent"].items()
        }

        # Fan-out per node. Pages convert Markdown in parallel; binaries
        # each upload + kick a child IngestWorkflow. We gather with
        # return_exceptions so one stray file can't abort the whole import
        # — the failure count surfaces in the UI instead.
        tasks: list[Any] = []
        for node in manifest["nodes"]:
            if node["kind"] == "page" and inp.source == "notion_zip":
                tasks.append(
                    workflow.execute_activity(
                        "convert_notion_md_to_plate",
                        {
                            "staging_dir": f"{_staging_base()}/{inp.job_id}",
                            "staging_path": node["meta"].get(
                                "md_path", node["path"]
                            ),
                            "note_id": idx_to_note_id[node["idx"]],
                            "uuid_link_map": manifest["uuid_link_map"],
                            "idx_to_note_id": {
                                str(k): v for k, v in idx_to_note_id.items()
                            },
                            "job_id": inp.job_id,
                        },
                        schedule_to_close_timeout=_SHORT,
                        retry_policy=_RETRY,
                    )
                )
            elif node["kind"] == "binary":
                parent = effective_parents.get(
                    node["idx"], target["parent_note_id"]
                )
                tasks.append(
                    self._run_binary(inp, node, parent, target)
                )
            # page nodes on the Drive side are already bound to the note
            # row by materialize_page_tree — no markdown content to convert.

        results = await asyncio.gather(*tasks, return_exceptions=True)
        failed: list[tuple[dict[str, Any], BaseException]] = [
            (node, exc)
            for node, exc in zip(manifest["nodes"], results, strict=False)
            if isinstance(exc, BaseException)
        ]
        error_summary: str | None = None
        if failed:
            lines = [
                f"{n['path']}: {type(e).__name__}: {e}"
                for n, e in failed[:100]
            ]
            if len(failed) > 100:
                lines.append(f"... and {len(failed) - 100} more")
            error_summary = "\n".join(lines)

        total = len(manifest["nodes"])
        completed = total - len(failed)
        await workflow.execute_activity(
            "finalize_import_job",
            {
                "job_id": inp.job_id,
                "user_id": inp.user_id,
                "completed_items": completed,
                "failed_items": len(failed),
                "total_items": total,
                "error_summary": error_summary,
            },
            schedule_to_close_timeout=_SHORT,
            retry_policy=_RETRY,
        )
        return {
            "total": total,
            "completed": completed,
            "failed": len(failed),
        }

    async def _run_binary(
        self,
        inp: ImportInput,
        node: dict[str, Any],
        parent_note_id: str | None,
        target: dict[str, Any],
    ) -> str:
        """Route a binary node through source-specific upload + IngestWorkflow."""
        if inp.source == "google_drive":
            upload = await workflow.execute_activity(
                "upload_drive_file_to_minio",
                {
                    "user_id": inp.user_id,
                    "drive_file_id": node["meta"]["drive_file_id"],
                    "mime": node["meta"]["mime"],
                    "export_from": node["meta"].get("export_from"),
                    "import_job_id": inp.job_id,
                    "workspace_id": inp.workspace_id,
                },
                schedule_to_close_timeout=_LONG,
                retry_policy=_RETRY,
            )
            object_key = upload["object_key"]
            mime = upload["mime"]
        else:  # notion_zip — copy staged file out to MinIO so the existing
               # IngestWorkflow can treat it the same as a user upload.
            object_key = (
                f"imports/notion/{inp.job_id}/"
                f"{node['meta']['staged_path']}"
            )
            mime = node["meta"]["mime"]
            await workflow.execute_activity(
                "upload_staging_to_minio",
                {
                    "staging_path": node["meta"]["staged_path"],
                    "job_id": inp.job_id,
                    "object_key": object_key,
                    "mime": mime,
                },
                schedule_to_close_timeout=_SHORT,
                retry_policy=_RETRY,
            )

        await workflow.execute_child_workflow(
            IngestWorkflow.run,
            IngestInput(
                object_key=object_key,
                file_name=node["display_name"],
                mime_type=mime,
                user_id=inp.user_id,
                project_id=target["project_id"],
                note_id=parent_note_id,
                workspace_id=inp.workspace_id,
            ),
            id=f"ingest-child-{inp.job_id}-{node['idx']}",
        )
        return "ok"
