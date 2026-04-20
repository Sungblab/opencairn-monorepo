"""Plan 4 Phase B E2E smoke test — bypasses tsx internal API via direct DB+Temporal.

Seeds a source note, then fires Compiler → Research → Librarian workflows
sequentially. Prints verification snapshots at each step.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

import asyncpg
from dotenv import load_dotenv
from temporalio.client import Client

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

USER_ID = "OlxpB93TWax4BakyVXkc7hT7f9hcVuLU"
WORKSPACE_ID = "74a03c26-d48a-4bf7-bf04-33eacc5e975b"
PROJECT_ID = "7e6dbfc0-a9a1-467b-89c0-4f10ce1e17b3"

PLATE_TEMPLATE = {
    "type": "doc",
    "content": [
        {
            "type": "p",
            "children": [{"text": ""}],
        }
    ],
}

SOURCE_CONTENT = (
    "A transformer is a neural network architecture that relies entirely on "
    "self-attention mechanisms to compute representations of its input and output "
    "without using sequence-aligned RNNs or convolution. Self-attention allows each "
    "token to directly attend to every other token, enabling parallelization that "
    "recurrent networks cannot match."
)


def plate_doc(text: str) -> dict:
    return {
        "type": "doc",
        "content": [{"type": "p", "children": [{"text": text}]}],
    }


async def insert_source_note(pool: asyncpg.Pool) -> str:
    note_id = str(uuid.uuid4())
    import json as _json
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO notes (
                id, project_id, workspace_id, title, content, content_text,
                type, source_type, mime_type, is_auto, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5::jsonb, $6, 'source', 'unknown', 'text/plain', true, NOW(), NOW()
            )
            """,
            note_id,
            PROJECT_ID,
            WORKSPACE_ID,
            "Transformer Architecture",
            _json.dumps(plate_doc(SOURCE_CONTENT)),
            SOURCE_CONTENT,
        )
    return note_id


async def db_snapshot(pool: asyncpg.Pool, label: str) -> None:
    async with pool.acquire() as conn:
        concepts = await conn.fetch(
            "SELECT id, name, description FROM concepts WHERE project_id=$1 ORDER BY created_at",
            PROJECT_ID,
        )
        concept_notes = await conn.fetchval(
            """SELECT count(*) FROM concept_notes cn
               JOIN concepts c ON c.id=cn.concept_id WHERE c.project_id=$1""",
            PROJECT_ID,
        )
        wiki_logs = await conn.fetchval(
            """SELECT count(*) FROM wiki_logs wl
               JOIN notes n ON n.id = wl.note_id
               WHERE n.project_id=$1""",
            PROJECT_ID,
        )
        semaphore = await conn.fetch(
            "SELECT project_id, purpose FROM project_semaphore_slots WHERE project_id=$1",
            PROJECT_ID,
        )
    print(f"\n=== snapshot {label} ===")
    print(f"concepts ({len(concepts)}):")
    for c in concepts:
        desc = (c["description"] or "")[:60]
        print(f"  - {c['name']}: {desc}")
    print(f"concept_notes links: {concept_notes}")
    print(f"wiki_logs rows: {wiki_logs}")
    print(f"semaphore slots: {len(semaphore)} {list(semaphore)}")


async def run_compiler(client: Client, note_id: str) -> dict:
    wid = f"e2e-compiler-{note_id}"
    print(f"\n>>> Starting CompilerWorkflow {wid}")
    handle = await client.start_workflow(
        "CompilerWorkflow",
        {
            "note_id": note_id,
            "project_id": PROJECT_ID,
            "workspace_id": WORKSPACE_ID,
            "user_id": USER_ID,
        },
        id=wid,
        task_queue="ingest",
    )
    result = await handle.result()
    print(f"<<< Compiler result: {result}")
    return result


async def run_research(client: Client) -> dict:
    wid = f"e2e-research-{uuid.uuid4()}"
    print(f"\n>>> Starting ResearchWorkflow {wid}")
    handle = await client.start_workflow(
        "ResearchWorkflow",
        {
            "query": "How does self-attention work?",
            "project_id": PROJECT_ID,
            "workspace_id": WORKSPACE_ID,
            "user_id": USER_ID,
        },
        id=wid,
        task_queue="ingest",
    )
    result = await handle.result()
    print(f"<<< Research result keys: {list(result.keys()) if isinstance(result, dict) else type(result)}")
    if isinstance(result, dict):
        ans = result.get("answer") or result.get("summary") or ""
        print(f"    answer[:200]: {str(ans)[:200]}")
        cites = result.get("citations") or []
        print(f"    citations: {len(cites)} → {cites[:3]}")
    return result


async def run_librarian(client: Client) -> dict:
    wid = f"e2e-librarian-{uuid.uuid4()}"
    print(f"\n>>> Starting LibrarianWorkflow {wid}")
    handle = await client.start_workflow(
        "LibrarianWorkflow",
        {
            "project_id": PROJECT_ID,
            "workspace_id": WORKSPACE_ID,
            "user_id": USER_ID,
        },
        id=wid,
        task_queue="ingest",
    )
    result = await handle.result()
    print(f"<<< Librarian result: {result}")
    return result


async def main() -> None:
    dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    temporal_addr = os.environ.get("TEMPORAL_ADDRESS", "localhost:7233")
    client = await Client.connect(temporal_addr)
    pool = await asyncpg.create_pool(dsn)
    try:
        note_id = await insert_source_note(pool)
        print(f"Inserted source note id={note_id}")
        await db_snapshot(pool, "pre-compiler")
        await run_compiler(client, note_id)
        await db_snapshot(pool, "post-compiler")
        await run_research(client)
        await db_snapshot(pool, "post-research")
        await run_librarian(client)
        await db_snapshot(pool, "post-librarian")
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
