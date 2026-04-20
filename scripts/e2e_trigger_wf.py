"""Trigger ResearchWorkflow or LibrarianWorkflow directly via Temporal client.

Usage: python e2e_trigger_wf.py research|librarian
"""
import asyncio
import os
import sys
import uuid

from temporalio.client import Client

USER_ID = "OlxpB93TWax4BakyVXkc7hT7f9hcVuLU"
WORKSPACE_ID = "74a03c26-d48a-4bf7-bf04-33eacc5e975b"
PROJECT_ID = "7e6dbfc0-a9a1-467b-89c0-4f10ce1e17b3"


async def main(kind: str) -> None:
    client = await Client.connect(os.environ.get("TEMPORAL_ADDRESS", "localhost:7233"))
    if kind == "research":
        wid = f"e2e-research-{uuid.uuid4()}"
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
    elif kind == "librarian":
        wid = f"e2e-librarian-{uuid.uuid4()}"
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
    else:
        sys.exit(f"unknown kind: {kind}")

    print(f"Started {wid}")
    result = await handle.result()
    print("RESULT:", result)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
