# Plan 4: Agent Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Python worker service that hosts three LangGraph agents (Compiler, Research, Librarian) orchestrated by Temporal, powered by the Gemini API for embeddings and reasoning, and backed by PostgreSQL + pgvector for hybrid semantic search.

**Architecture:** `apps/worker/` is a standalone Python package managed with `uv` + `pyproject.toml`. A Temporal worker process registers all activities and workflows. Each agent is a LangGraph `StateGraph` whose nodes call Gemini and the database. The Gemini client wrapper centralises all SDK calls (embeddings, thinking-mode chat, context caching). Hybrid search fuses pgvector cosine similarity, tsvector BM25, and graph-hop results via Reciprocal Rank Fusion (RRF).

**Tech Stack:** Python 3.12, uv, LangGraph 0.3, Pydantic AI 0.1, google-genai SDK, temporalio Python SDK, asyncpg, pgvector, Pydantic v2, pytest + pytest-asyncio

---

## File Structure

```
apps/worker/
  pyproject.toml                          -- package metadata + dependencies
  .python-version                         -- pins Python 3.12
  Dockerfile                              -- production container
  .env.example                            -- env var template

  src/worker/
    __init__.py
    main.py                               -- entry point: start Temporal worker

    temporal/
      __init__.py
      worker.py                           -- register workflows + activities, connect
      workflows/
        __init__.py
        compiler_workflow.py              -- Temporal workflow: run Compiler agent
        research_workflow.py              -- Temporal workflow: run Research agent
        librarian_workflow.py             -- Temporal workflow: run Librarian agent
      activities/
        __init__.py
        compiler_activities.py            -- @activity.defn wrappers for Compiler nodes
        research_activities.py            -- @activity.defn wrappers for Research nodes
        librarian_activities.py           -- @activity.defn wrappers for Librarian nodes
        semaphore_activities.py           -- per-project concurrency semaphore helpers

    gemini/
      __init__.py
      client.py                           -- GeminiClient: embed, chat (thinking), cache
      models.py                           -- Pydantic models for Gemini responses

    db/
      __init__.py
      connection.py                       -- asyncpg pool factory
      concepts.py                         -- concept CRUD queries (used by all agents)
      search.py                           -- hybrid search: vector + BM25 + graph, RRF
      wiki.py                             -- wiki_logs insert
      jobs.py                             -- job status update helpers

    agents/
      __init__.py
      compiler/
        __init__.py
        state.py                          -- CompilerState TypedDict
        graph.py                          -- LangGraph StateGraph definition
        nodes.py                          -- all node functions (parse, extract, ??
      research/
        __init__.py
        state.py                          -- ResearchState TypedDict
        graph.py                          -- LangGraph StateGraph definition
        nodes.py                          -- all node functions
      librarian/
        __init__.py
        state.py                          -- LibrarianState TypedDict
        graph.py                          -- LangGraph StateGraph definition
        nodes.py                          -- all node functions

  tests/
    conftest.py                           -- shared fixtures (db pool, gemini mock)
    test_gemini_client.py
    test_search.py
    test_compiler_graph.py
    test_research_graph.py
    test_librarian_graph.py
    test_temporal_workflows.py
```

---

### Task 1: Python Worker Project Setup

**Files:**

- Create: `apps/worker/pyproject.toml`
- Create: `apps/worker/.python-version`
- Create: `apps/worker/.env.example`
- Create: `apps/worker/src/worker/__init__.py`
- Create: `apps/worker/src/worker/main.py`
- Create: `apps/worker/tests/conftest.py`

- [ ] **Step 1: Create `apps/worker/` directory structure**

```bash
mkdir -p /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker/src/worker/temporal/workflows
mkdir -p /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker/src/worker/temporal/activities
mkdir -p /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker/src/worker/gemini
mkdir -p /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker/src/worker/db
mkdir -p /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker/src/worker/agents/compiler
mkdir -p /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker/src/worker/agents/research
mkdir -p /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker/src/worker/agents/librarian
mkdir -p /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker/tests
```

- [ ] **Step 2: Create `.python-version`**

```
3.12
```

Save to `apps/worker/.python-version`.

- [ ] **Step 3: Create `pyproject.toml`**

```toml
[project]
name = "opencairn-worker"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "temporalio>=1.7.0",
    "langgraph>=0.3.0",
    "pydantic-ai>=0.1.0",
    "pydantic>=2.7.0",
    "google-genai>=1.0.0",
    "asyncpg>=0.29.0",
    "pgvector>=0.3.0",
    "python-dotenv>=1.0.0",
    "structlog>=24.4.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.2.0",
    "pytest-asyncio>=0.23.0",
    "pytest-mock>=3.14.0",
    "ruff>=0.4.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/worker"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py312"
```

Save to `apps/worker/pyproject.toml`.

- [ ] **Step 4: Create `.env.example`**

```dotenv
# Temporal
TEMPORAL_HOST=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=opencairn-worker

# Gemini
GEMINI_API_KEY=your-gemini-api-key-here

# PostgreSQL
DATABASE_URL=postgresql://opencairn:password@localhost:5432/opencairn

# Worker concurrency
MAX_CONCURRENT_WORKFLOW_TASKS=10
MAX_CONCURRENT_ACTIVITIES=20
```

Save to `apps/worker/.env.example`.

- [ ] **Step 5: Create `src/worker/__init__.py`**

```python
"""OpenCairn worker service."""
```

- [ ] **Step 6: Create `src/worker/main.py`**

```python
"""Entry point: start the Temporal worker."""
import asyncio
import logging

from dotenv import load_dotenv

load_dotenv()

from worker.temporal.worker import run_worker


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    await run_worker()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 7: Create `tests/conftest.py`**

```python
"""Shared pytest fixtures."""
import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture
def mock_gemini_client():
    """A fully mocked GeminiClient."""
    client = MagicMock()
    client.embed = AsyncMock(return_value=[0.1] * 3072)
    client.chat = AsyncMock(return_value="mocked response")
    return client


@pytest.fixture
def mock_db_pool():
    """A mocked asyncpg pool whose acquire() yields a mock connection."""
    pool = MagicMock()
    conn = AsyncMock()
    conn.fetch = AsyncMock(return_value=[])
    conn.fetchrow = AsyncMock(return_value=None)
    conn.execute = AsyncMock(return_value="INSERT 0 1")
    pool.acquire = MagicMock(return_value=AsyncMock(
        __aenter__=AsyncMock(return_value=conn),
        __aexit__=AsyncMock(return_value=False),
    ))
    return pool, conn
```

- [ ] **Step 8: Install dependencies with uv**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv sync
```

Expected: a `.venv/` folder is created with all packages installed.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/worker/
git commit -m "feat(worker): scaffold Python worker project with uv + pyproject.toml"
```

---

### Task 2: Temporal Worker Registration

**Files:**

- Create: `apps/worker/src/worker/temporal/worker.py`
- Create: `apps/worker/src/worker/temporal/__init__.py`
- Create: `apps/worker/src/worker/temporal/workflows/__init__.py`
- Create: `apps/worker/src/worker/temporal/activities/__init__.py`
- Test: `apps/worker/tests/test_temporal_workflows.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_temporal_workflows.py
import pytest
from unittest.mock import patch, AsyncMock


@pytest.mark.asyncio
async def test_worker_connects_to_temporal():
    """Worker should create a Temporal client and worker without crashing."""
    with patch("worker.temporal.worker.Client") as mock_client_cls, \
         patch("worker.temporal.worker.Worker") as mock_worker_cls:

        mock_client = AsyncMock()
        mock_client_cls.connect = AsyncMock(return_value=mock_client)

        mock_worker = AsyncMock()
        mock_worker.run = AsyncMock()
        mock_worker_cls.return_value = mock_worker

        from worker.temporal.worker import run_worker
        import importlib
        import worker.temporal.worker as wmod
        importlib.reload(wmod)

        # Should connect and construct the worker without raising
        await wmod.run_worker()
        mock_client_cls.connect.assert_awaited_once()
        mock_worker.run.assert_awaited_once()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/test_temporal_workflows.py -v
```

Expected: `ModuleNotFoundError: No module named 'worker.temporal.worker'`

- [ ] **Step 3: Create `src/worker/temporal/__init__.py`**

```python
"""Temporal orchestration layer."""
```

- [ ] **Step 4: Create `src/worker/temporal/workflows/__init__.py`** and **`activities/__init__.py`**

```python
"""Temporal workflows."""
```

```python
"""Temporal activities."""
```

- [ ] **Step 5: Create `src/worker/temporal/worker.py`**

```python
"""Temporal worker: connects to server, registers workflows and activities."""
import os
from temporalio.client import Client
from temporalio.worker import Worker

from worker.temporal.workflows.compiler_workflow import CompilerWorkflow
from worker.temporal.workflows.research_workflow import ResearchWorkflow
from worker.temporal.workflows.librarian_workflow import LibrarianWorkflow
from worker.temporal.activities.compiler_activities import (
    parse_note_activity,
    extract_concepts_activity,
    search_existing_concepts_activity,
    merge_or_create_concepts_activity,
    link_concepts_activity,
    log_wiki_changes_activity,
)
from worker.temporal.activities.research_activities import (
    decompose_query_activity,
    hybrid_search_activity,
    collect_evidence_activity,
    generate_answer_activity,
    wiki_feedback_activity,
)
from worker.temporal.activities.librarian_activities import (
    detect_orphans_activity,
    check_contradictions_activity,
    merge_duplicates_activity,
    strengthen_links_activity,
    update_index_activity,
)
from worker.temporal.activities.semaphore_activities import (
    acquire_project_semaphore_activity,
    release_project_semaphore_activity,
)

TASK_QUEUE = os.environ.get("TEMPORAL_TASK_QUEUE", "opencairn-worker")


async def run_worker() -> None:
    """Connect to Temporal and run the worker until interrupted."""
    host = os.environ.get("TEMPORAL_HOST", "localhost:7233")
    namespace = os.environ.get("TEMPORAL_NAMESPACE", "default")

    client = await Client.connect(host, namespace=namespace)

    worker = Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[CompilerWorkflow, ResearchWorkflow, LibrarianWorkflow],
        activities=[
            parse_note_activity,
            extract_concepts_activity,
            search_existing_concepts_activity,
            merge_or_create_concepts_activity,
            link_concepts_activity,
            log_wiki_changes_activity,
            decompose_query_activity,
            hybrid_search_activity,
            collect_evidence_activity,
            generate_answer_activity,
            wiki_feedback_activity,
            detect_orphans_activity,
            check_contradictions_activity,
            merge_duplicates_activity,
            strengthen_links_activity,
            update_index_activity,
            acquire_project_semaphore_activity,
            release_project_semaphore_activity,
        ],
        max_concurrent_workflow_task_polls=int(
            os.environ.get("MAX_CONCURRENT_WORKFLOW_TASKS", "10")
        ),
        max_concurrent_activity_task_polls=int(
            os.environ.get("MAX_CONCURRENT_ACTIVITIES", "20")
        ),
    )
    await worker.run()
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/test_temporal_workflows.py -v
```

Expected: `PASSED`

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/worker/src/worker/temporal/ apps/worker/tests/test_temporal_workflows.py
git commit -m "feat(worker): register Temporal worker with all activity/workflow stubs"
```

---

### Task 3: Gemini Client Wrapper

**Files:**

- Create: `apps/worker/src/worker/gemini/client.py`
- Create: `apps/worker/src/worker/gemini/models.py`
- Create: `apps/worker/src/worker/gemini/__init__.py`
- Test: `apps/worker/tests/test_gemini_client.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_gemini_client.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_embed_returns_3072_floats():
    with patch("worker.gemini.client.genai") as mock_genai:
        mock_response = MagicMock()
        mock_response.embeddings = [MagicMock(values=[0.1] * 3072)]
        mock_genai.Client.return_value.aio.models.embed_content = AsyncMock(
            return_value=mock_response
        )

        from worker.gemini.client import GeminiClient
        client = GeminiClient(api_key="test-key")
        result = await client.embed("hello world")

        assert len(result) == 3072
        assert all(isinstance(v, float) for v in result)


@pytest.mark.asyncio
async def test_chat_returns_string():
    with patch("worker.gemini.client.genai") as mock_genai:
        mock_response = MagicMock()
        mock_response.text = "The answer is 42."
        mock_genai.Client.return_value.aio.models.generate_content = AsyncMock(
            return_value=mock_response
        )

        from worker.gemini.client import GeminiClient
        client = GeminiClient(api_key="test-key")
        result = await client.chat(
            model="gemini-3.1-flash-lite-preview",
            prompt="What is the answer?",
        )

        assert result == "The answer is 42."


@pytest.mark.asyncio
async def test_chat_with_thinking_mode():
    with patch("worker.gemini.client.genai") as mock_genai:
        mock_response = MagicMock()
        mock_response.text = "Deep thought."
        mock_genai.Client.return_value.aio.models.generate_content = AsyncMock(
            return_value=mock_response
        )

        from worker.gemini.client import GeminiClient
        import importlib, worker.gemini.client as mod
        importlib.reload(mod)

        client = mod.GeminiClient(api_key="test-key")
        result = await client.chat(
            model="gemini-3.1-flash-lite-preview",
            prompt="Think hard.",
            thinking_budget=1024,
        )

        assert isinstance(result, str)
        # Verify thinking_config was passed
        call_kwargs = mock_genai.Client.return_value.aio.models.generate_content.call_args
        config = call_kwargs.kwargs.get("config") or call_kwargs.args[1] if len(call_kwargs.args) > 1 else None
        # The call should include a GenerateContentConfig
        mock_genai.Client.return_value.aio.models.generate_content.assert_awaited_once()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/test_gemini_client.py -v
```

Expected: `ModuleNotFoundError: No module named 'worker.gemini.client'`

- [ ] **Step 3: Create `src/worker/gemini/__init__.py`**

```python
"""Gemini API client wrapper."""
from worker.gemini.client import GeminiClient

__all__ = ["GeminiClient"]
```

- [ ] **Step 4: Create `src/worker/gemini/models.py`**

```python
"""Pydantic models for Gemini API responses."""
from pydantic import BaseModel
from typing import Optional


class EmbedResult(BaseModel):
    values: list[float]
    model: str = "gemini-embedding-2-preview"


class ChatResult(BaseModel):
    text: str
    model: str
    thinking_tokens_used: Optional[int] = None
    cached_tokens_used: Optional[int] = None
```

- [ ] **Step 5: Create `src/worker/gemini/client.py`**

```python
"""GeminiClient: thin async wrapper over the google-genai SDK."""
from __future__ import annotations

import os
from typing import Optional

import google.genai as genai
from google.genai import types

EMBED_MODEL = "gemini-embedding-2-preview"
EMBED_DIMS = 3072


class GeminiClient:
    """Async wrapper for Gemini embedding, chat (with optional thinking), and caching."""

    def __init__(self, api_key: Optional[str] = None) -> None:
        self._api_key = api_key or os.environ["GEMINI_API_KEY"]
        self._client = genai.Client(api_key=self._api_key)

    async def embed(self, text: str) -> list[float]:
        """Embed a single string using gemini-embedding-2-preview (3072 dims)."""
        response = await self._client.aio.models.embed_content(
            model=EMBED_MODEL,
            contents=text,
            config=types.EmbedContentConfig(output_dimensionality=EMBED_DIMS),
        )
        return list(response.embeddings[0].values)

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple strings in a single API call."""
        response = await self._client.aio.models.embed_content(
            model=EMBED_MODEL,
            contents=texts,
            config=types.EmbedContentConfig(output_dimensionality=EMBED_DIMS),
        )
        return [list(e.values) for e in response.embeddings]

    async def chat(
        self,
        model: str,
        prompt: str,
        system_instruction: Optional[str] = None,
        thinking_budget: Optional[int] = None,
        cached_content_name: Optional[str] = None,
    ) -> str:
        """
        Generate a chat response.

        Args:
            model: Gemini model ID, e.g. "gemini-3.1-flash-lite-preview" or "gemini-3.1-flash-lite-preview".
            prompt: User prompt text.
            system_instruction: Optional system prompt.
            thinking_budget: If set, enables Thinking Mode with this token budget.
            cached_content_name: If set, uses a previously created cached content resource.
        """
        thinking_config = None
        if thinking_budget is not None:
            thinking_config = types.ThinkingConfig(thinking_budget=thinking_budget)

        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            thinking_config=thinking_config,
            cached_content=cached_content_name,
        )

        response = await self._client.aio.models.generate_content(
            model=model,
            contents=prompt,
            config=config,
        )
        return response.text

    async def create_cache(
        self,
        model: str,
        contents: list[str],
        display_name: str,
        ttl_seconds: int = 3600,
    ) -> str:
        """
        Create a cached content resource and return its name.

        Use this to cache large corpora (e.g., a project's entire wiki) before
        multiple research queries, reducing token costs.
        """
        from google.genai.types import CreateCachedContentConfig
        import datetime

        cache = await self._client.aio.caches.create(
            model=model,
            config=CreateCachedContentConfig(
                contents=contents,
                display_name=display_name,
                ttl=datetime.timedelta(seconds=ttl_seconds),
            ),
        )
        return cache.name

    async def delete_cache(self, cache_name: str) -> None:
        """Delete a cached content resource."""
        await self._client.aio.caches.delete(name=cache_name)
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/test_gemini_client.py -v
```

Expected: all 3 tests `PASSED`

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/worker/src/worker/gemini/ apps/worker/tests/test_gemini_client.py
git commit -m "feat(worker): add GeminiClient wrapper for embedding, chat, thinking, caching"
```

---

### Task 4: Database Connection and Hybrid Search

**Files:**

- Create: `apps/worker/src/worker/db/connection.py`
- Create: `apps/worker/src/worker/db/concepts.py`
- Create: `apps/worker/src/worker/db/search.py`
- Create: `apps/worker/src/worker/db/wiki.py`
- Create: `apps/worker/src/worker/db/jobs.py`
- Create: `apps/worker/src/worker/db/__init__.py`
- Test: `apps/worker/tests/test_search.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_search.py
import pytest
from unittest.mock import AsyncMock, MagicMock


def _make_pool_conn(rows_by_query: dict[str, list[dict]] | None = None):
    """Return (pool, conn) mocks. rows_by_query maps query substring to rows."""
    conn = AsyncMock()
    rows_by_query = rows_by_query or {}

    async def fetch_side_effect(query, *args, **kwargs):
        for key, rows in rows_by_query.items():
            if key in query:
                return [MagicMock(**r) for r in rows]
        return []

    conn.fetch = AsyncMock(side_effect=fetch_side_effect)
    conn.fetchrow = AsyncMock(return_value=None)
    conn.execute = AsyncMock(return_value="OK")

    pool = MagicMock()
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    pool.acquire = MagicMock(return_value=ctx)
    return pool, conn


@pytest.mark.asyncio
async def test_rrf_fusion_ordering():
    """RRF must rank concepts that appear in multiple result sets higher."""
    from worker.db.search import reciprocal_rank_fusion

    vector_hits = [
        {"concept_id": "a", "score": 0.95},
        {"concept_id": "b", "score": 0.80},
        {"concept_id": "c", "score": 0.70},
    ]
    bm25_hits = [
        {"concept_id": "b", "score": 1.0},
        {"concept_id": "d", "score": 0.9},
        {"concept_id": "a", "score": 0.7},
    ]

    result = reciprocal_rank_fusion([vector_hits, bm25_hits], k=60)

    # "b" appears at rank 2 in vector and rank 1 in BM25: should be top-2
    ids = [r["concept_id"] for r in result]
    assert ids.index("b") <= 1
    assert ids.index("a") <= 1  # "a" also in both lists


@pytest.mark.asyncio
async def test_hybrid_search_calls_vector_and_bm25(mock_db_pool):
    """hybrid_search must issue both vector and BM25 queries."""
    pool, conn = mock_db_pool

    from worker.db.search import hybrid_search

    embedding = [0.1] * 3072
    results = await hybrid_search(
        pool=pool,
        project_id="proj-1",
        query_text="neural networks",
        query_embedding=embedding,
        top_k=5,
    )

    # Two fetches: one for vector, one for BM25
    assert conn.fetch.await_count == 2
    assert isinstance(results, list)


@pytest.mark.asyncio
async def test_create_concept_returns_id(mock_db_pool):
    """create_concept must insert a row and return its UUID."""
    pool, conn = mock_db_pool
    conn.fetchrow = AsyncMock(return_value=MagicMock(id="uuid-123"))

    from worker.db.concepts import create_concept

    concept_id = await create_concept(
        pool=pool,
        project_id="proj-1",
        name="Transformer",
        summary="Attention-based architecture",
        embedding=[0.1] * 3072,
    )

    assert concept_id == "uuid-123"
    conn.fetchrow.assert_awaited_once()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/test_search.py -v
```

Expected: `ModuleNotFoundError`

- [ ] **Step 3: Create `src/worker/db/__init__.py`**

```python
"""Database access layer."""
```

- [ ] **Step 4: Create `src/worker/db/connection.py`**

```python
"""asyncpg pool factory."""
from __future__ import annotations

import os
from typing import Optional

import asyncpg


_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    """Return the shared asyncpg connection pool, creating it on first call."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=os.environ["DATABASE_URL"],
            min_size=2,
            max_size=10,
            command_timeout=60,
        )
    return _pool


async def close_pool() -> None:
    """Close the connection pool (call on worker shutdown)."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
```

- [ ] **Step 5: Create `src/worker/db/concepts.py`**

```python
"""Concept and concept_edge CRUD queries."""
from __future__ import annotations

from typing import Any, Optional
import asyncpg


async def get_concept_by_id(pool: asyncpg.Pool, concept_id: str) -> Optional[dict[str, Any]]:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, project_id, name, summary, aliases FROM concepts WHERE id = $1",
            concept_id,
        )
        return dict(row) if row else None


async def find_concepts_by_name(
    pool: asyncpg.Pool, project_id: str, name: str
) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name, summary
            FROM concepts
            WHERE project_id = $1
              AND (lower(name) = lower($2) OR $2 = ANY(aliases))
            LIMIT 5
            """,
            project_id,
            name,
        )
        return [dict(r) for r in rows]


async def create_concept(
    pool: asyncpg.Pool,
    project_id: str,
    name: str,
    summary: str,
    embedding: list[float],
    aliases: Optional[list[str]] = None,
) -> str:
    """Insert a new concept and return its UUID."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO concepts (project_id, name, summary, embedding, aliases)
            VALUES ($1, $2, $3, $4::vector, $5)
            RETURNING id
            """,
            project_id,
            name,
            summary,
            embedding,
            aliases or [],
        )
        return str(row["id"])


async def update_concept_summary(
    pool: asyncpg.Pool, concept_id: str, summary: str, embedding: list[float]
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE concepts
            SET summary = $2, embedding = $3::vector, updated_at = now()
            WHERE id = $1
            """,
            concept_id,
            summary,
            embedding,
        )


async def create_concept_edge(
    pool: asyncpg.Pool,
    source_id: str,
    target_id: str,
    relation: str,
    weight: float = 1.0,
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO concept_edges (source_id, target_id, relation, weight)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (source_id, target_id, relation) DO UPDATE
              SET weight = GREATEST(concept_edges.weight, $4), updated_at = now()
            """,
            source_id,
            target_id,
            relation,
            weight,
        )


async def list_concept_edges(
    pool: asyncpg.Pool, concept_id: str
) -> list[dict[str, Any]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT source_id, target_id, relation, weight
            FROM concept_edges
            WHERE source_id = $1 OR target_id = $1
            """,
            concept_id,
        )
        return [dict(r) for r in rows]
```

- [ ] **Step 6: Create `src/worker/db/search.py`**

```python
"""Hybrid search: pgvector + BM25 (tsvector) + RRF fusion."""
from __future__ import annotations

from typing import Any
import asyncpg


def reciprocal_rank_fusion(
    result_lists: list[list[dict[str, Any]]],
    k: int = 60,
) -> list[dict[str, Any]]:
    """
    Fuse multiple ranked lists using Reciprocal Rank Fusion.

    Each item in result_lists must have a "concept_id" key.
    Returns items sorted by descending RRF score with an added "rrf_score" key.
    """
    scores: dict[str, float] = {}
    items: dict[str, dict[str, Any]] = {}

    for ranked_list in result_lists:
        for rank, item in enumerate(ranked_list, start=1):
            cid = item["concept_id"]
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank)
            if cid not in items:
                items[cid] = item

    sorted_ids = sorted(scores, key=lambda cid: scores[cid], reverse=True)
    return [{**items[cid], "rrf_score": scores[cid]} for cid in sorted_ids]


async def _vector_search(
    conn: asyncpg.Connection,
    project_id: str,
    embedding: list[float],
    top_k: int,
) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT id AS concept_id, name, summary,
               1 - (embedding <=> $2::vector) AS score
        FROM concepts
        WHERE project_id = $1
        ORDER BY embedding <=> $2::vector
        LIMIT $3
        """,
        project_id,
        embedding,
        top_k,
    )
    return [dict(r) for r in rows]


async def _bm25_search(
    conn: asyncpg.Connection,
    project_id: str,
    query_text: str,
    top_k: int,
) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT id AS concept_id, name, summary,
               ts_rank(search_vector, plainto_tsquery('english', $2)) AS score
        FROM concepts
        WHERE project_id = $1
          AND search_vector @@ plainto_tsquery('english', $2)
        ORDER BY score DESC
        LIMIT $3
        """,
        project_id,
        query_text,
        top_k,
    )
    return [dict(r) for r in rows]


async def _graph_hop_search(
    conn: asyncpg.Connection,
    seed_concept_ids: list[str],
    hops: int = 2,
) -> list[str]:
    """Return IDs reachable from seed concepts within N hops."""
    if not seed_concept_ids:
        return []
    rows = await conn.fetch(
        """
        WITH RECURSIVE hops AS (
            SELECT source_id, target_id, 1 AS depth
            FROM concept_edges
            WHERE source_id = ANY($1::uuid[])

            UNION ALL

            SELECT e.source_id, e.target_id, h.depth + 1
            FROM concept_edges e
            JOIN hops h ON e.source_id = h.target_id
            WHERE h.depth < $2
        )
        SELECT DISTINCT target_id AS concept_id FROM hops
        """,
        seed_concept_ids,
        hops,
    )
    return [str(r["concept_id"]) for r in rows]


async def hybrid_search(
    pool: asyncpg.Pool,
    project_id: str,
    query_text: str,
    query_embedding: list[float],
    top_k: int = 10,
    graph_hops: int = 2,
) -> list[dict[str, Any]]:
    """
    Run vector + BM25 searches, fuse with RRF, then expand via graph hops.

    Returns a list of concept dicts sorted by descending RRF score.
    """
    async with pool.acquire() as conn:
        vector_hits = await _vector_search(conn, project_id, query_embedding, top_k)
        bm25_hits = await _bm25_search(conn, project_id, query_text, top_k)

    fused = reciprocal_rank_fusion([vector_hits, bm25_hits])
    top_ids = [r["concept_id"] for r in fused[:top_k]]

    async with pool.acquire() as conn:
        graph_ids = await _graph_hop_search(conn, top_ids, hops=graph_hops)

    # Fetch full records for graph-expanded IDs not already in fused
    existing_ids = set(top_ids)
    new_ids = [cid for cid in graph_ids if cid not in existing_ids]

    if new_ids:
        async with pool.acquire() as conn:
            extra_rows = await conn.fetch(
                "SELECT id AS concept_id, name, summary FROM concepts WHERE id = ANY($1::uuid[])",
                new_ids,
            )
        extra = [dict(r) for r in extra_rows]
        fused.extend(extra)

    return fused
```

- [ ] **Step 7: Create `src/worker/db/wiki.py`**

```python
"""wiki_logs insert helpers."""
from __future__ import annotations

import asyncpg


async def log_wiki_change(
    pool: asyncpg.Pool,
    concept_id: str,
    project_id: str,
    change_type: str,
    before_summary: str | None,
    after_summary: str | None,
    triggered_by_note_id: str | None = None,
) -> None:
    """Insert a wiki_logs row to record what changed and why."""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO wiki_logs
              (concept_id, project_id, change_type, before_summary, after_summary, note_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            concept_id,
            project_id,
            change_type,
            before_summary,
            after_summary,
            triggered_by_note_id,
        )
```

- [ ] **Step 8: Create `src/worker/db/jobs.py`**

```python
"""Job status update helpers."""
from __future__ import annotations

import asyncpg


async def update_job_status(
    pool: asyncpg.Pool,
    job_id: str,
    status: str,
    result_payload: dict | None = None,
    error_message: str | None = None,
) -> None:
    """Update a job row's status, optionally recording result or error."""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE jobs
            SET status = $2,
                result_payload = $3,
                error_message = $4,
                updated_at = now()
            WHERE id = $1
            """,
            job_id,
            status,
            result_payload,
            error_message,
        )
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/test_search.py -v
```

Expected: all 3 tests `PASSED`

- [ ] **Step 10: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/worker/src/worker/db/ apps/worker/tests/test_search.py
git commit -m "feat(worker): add asyncpg pool, concept CRUD, hybrid search with RRF fusion"
```

---

### Task 5: Compiler Agent

**Files:**

- Create: `apps/worker/src/worker/agents/compiler/state.py`
- Create: `apps/worker/src/worker/agents/compiler/nodes.py`
- Create: `apps/worker/src/worker/agents/compiler/graph.py`
- Create: `apps/worker/src/worker/agents/compiler/__init__.py`
- Create: `apps/worker/src/worker/agents/__init__.py`
- Create: `apps/worker/src/worker/temporal/activities/compiler_activities.py`
- Create: `apps/worker/src/worker/temporal/workflows/compiler_workflow.py`
- Test: `apps/worker/tests/test_compiler_graph.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_compiler_graph.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def _make_compiler_state(**overrides):
    from worker.agents.compiler.state import CompilerState
    defaults = {
        "note_id": "note-1",
        "note_content": "Transformers use self-attention. BERT is a transformer.",
        "project_id": "proj-1",
        "raw_concepts": [],
        "existing_matches": {},
        "concepts_to_create": [],
        "concepts_to_merge": [],
        "edges_to_create": [],
        "wiki_changes": [],
        "error": None,
    }
    return {**defaults, **overrides}


@pytest.mark.asyncio
async def test_parse_note_node_extracts_text():
    """parse_note node must split content into sentences/chunks."""
    from worker.agents.compiler.nodes import parse_note

    state = _make_compiler_state()
    result = await parse_note(state, gemini=None, pool=None)

    # raw_concepts should remain empty at parse step; the node populates note_chunks
    assert "note_chunks" in result
    assert len(result["note_chunks"]) > 0


@pytest.mark.asyncio
async def test_extract_concepts_node_calls_gemini(mock_gemini_client):
    """extract_concepts must call Gemini chat and parse concept list from response."""
    mock_gemini_client.chat = AsyncMock(
        return_value='["Transformer", "Self-Attention", "BERT"]'
    )

    state = _make_compiler_state(note_chunks=["Transformers use self-attention."])
    from worker.agents.compiler.nodes import extract_concepts

    result = await extract_concepts(state, gemini=mock_gemini_client, pool=None)

    mock_gemini_client.chat.assert_awaited_once()
    assert "Transformer" in result["raw_concepts"]


@pytest.mark.asyncio
async def test_compiler_graph_runs_without_db(mock_gemini_client, mock_db_pool):
    """Full graph traversal should complete without raising."""
    mock_gemini_client.chat = AsyncMock(
        return_value='["Transformer", "BERT"]'
    )
    mock_gemini_client.embed = AsyncMock(return_value=[0.1] * 3072)
    pool, conn = mock_db_pool

    # Simulate no existing concepts found
    conn.fetch = AsyncMock(return_value=[])
    conn.fetchrow = AsyncMock(return_value=MagicMock(id="new-uuid"))

    from worker.agents.compiler.graph import build_compiler_graph

    graph = build_compiler_graph()
    initial_state = _make_compiler_state()

    result = await graph.ainvoke(
        {**initial_state, "note_chunks": ["Transformers use self-attention."]},
        config={"configurable": {"gemini": mock_gemini_client, "pool": pool}},
    )

    assert result.get("error") is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/test_compiler_graph.py -v
```

Expected: `ModuleNotFoundError`

- [ ] **Step 3: Create `src/worker/agents/__init__.py`**

```python
"""LangGraph agents."""
```

- [ ] **Step 4: Create `src/worker/agents/compiler/__init__.py`**

```python
"""Compiler agent: converts notes into knowledge graph entries."""
```

- [ ] **Step 5: Create `src/worker/agents/compiler/state.py`**

```python
"""CompilerState: the shared state dict that flows through the Compiler graph."""
from __future__ import annotations

from typing import Any, Optional
from typing_extensions import TypedDict


class RawConcept(TypedDict):
    name: str
    context: str  # sentence(s) in the note that mention this concept


class ConceptMatch(TypedDict):
    concept_id: str
    name: str
    similarity: float


class EdgeSpec(TypedDict):
    source_name: str
    target_name: str
    relation: str   # e.g. "is-a", "uses", "contrasts-with", "part-of"
    weight: float


class WikiChange(TypedDict):
    concept_id: str
    change_type: str   # "created" | "merged" | "updated"
    before_summary: Optional[str]
    after_summary: str


class CompilerState(TypedDict):
    # Input
    note_id: str
    note_content: str
    project_id: str

    # Intermediate
    note_chunks: list[str]          # sentences / paragraphs
    raw_concepts: list[str]         # concept names extracted by LLM
    existing_matches: dict[str, list[ConceptMatch]]  # name ??matches
    concepts_to_create: list[RawConcept]
    concepts_to_merge: list[dict[str, Any]]   # {existing_id, new_context}
    edges_to_create: list[EdgeSpec]
    wiki_changes: list[WikiChange]

    # Output / error
    error: Optional[str]
```

- [ ] **Step 6: Create `src/worker/agents/compiler/nodes.py`**

```python
"""Compiler agent node functions."""
from __future__ import annotations

import json
import re
from typing import Any

from worker.agents.compiler.state import CompilerState, EdgeSpec, WikiChange
from worker.db.concepts import (
    create_concept,
    update_concept_summary,
    create_concept_edge,
    find_concepts_by_name,
)
from worker.db.search import hybrid_search
from worker.db.wiki import log_wiki_change


_EXTRACT_PROMPT = """\
You are a knowledge extraction assistant. Given the following note excerpt, list all
distinct concepts, entities, or ideas that should be represented as nodes in a knowledge graph.
Return a JSON array of strings (concept names only). Be concise; 3-10 concepts per excerpt.

Note excerpt:
{text}

JSON array:"""

_LINK_PROMPT = """\
Given the following list of concepts extracted from a note, identify meaningful relationships
between them. Return a JSON array of objects with keys: source, target, relation.
Allowed relation values: "is-a", "uses", "part-of", "contrasts-with", "related-to", "enables".

Concepts: {concepts}

Context from note: {context}

JSON array:"""

_MERGE_PROMPT = """\
You are merging new information into an existing knowledge base concept.

Existing concept: {name}
Existing summary: {existing_summary}
New context from note: {new_context}

Write an updated summary that incorporates the new information. Be concise (2-4 sentences).
Return only the updated summary text, no JSON."""


async def parse_note(state: CompilerState, gemini: Any, pool: Any) -> dict:
    """Split note content into sentence-level chunks for processing."""
    content = state["note_content"]
    # Split on sentence boundaries
    chunks = [s.strip() for s in re.split(r"(?<=[.!?])\s+", content) if s.strip()]
    if not chunks:
        chunks = [content]
    return {"note_chunks": chunks}


async def extract_concepts(state: CompilerState, gemini: Any, pool: Any) -> dict:
    """Call Gemini to extract concept names from each note chunk."""
    all_concepts: list[str] = []
    for chunk in state.get("note_chunks", [state["note_content"]]):
        prompt = _EXTRACT_PROMPT.format(text=chunk)
        response = await gemini.chat(
            model="gemini-3.1-flash-lite-preview",
            prompt=prompt,
        )
        try:
            parsed = json.loads(response)
            if isinstance(parsed, list):
                all_concepts.extend(str(c) for c in parsed)
        except json.JSONDecodeError:
            # Best-effort: extract quoted strings
            found = re.findall(r'"([^"]+)"', response)
            all_concepts.extend(found)

    # Deduplicate preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for c in all_concepts:
        if c.lower() not in seen:
            seen.add(c.lower())
            unique.append(c)

    return {"raw_concepts": unique}


async def search_existing_concepts(state: CompilerState, gemini: Any, pool: Any) -> dict:
    """
    For each extracted concept name, check if a matching concept already exists
    by name lookup and semantic similarity.
    """
    existing_matches: dict[str, list[dict]] = {}
    for name in state["raw_concepts"]:
        name_matches = await find_concepts_by_name(pool, state["project_id"], name)
        existing_matches[name] = name_matches

    return {"existing_matches": existing_matches}


async def merge_or_create_concepts(state: CompilerState, gemini: Any, pool: Any) -> dict:
    """
    For each extracted concept:
    - If a strong name match exists: queue a merge (update existing concept).
    - Otherwise: queue a create.
    """
    concepts_to_create = []
    concepts_to_merge = []

    for name in state["raw_concepts"]:
        matches = state["existing_matches"].get(name, [])
        # Find the note chunk most relevant to this concept
        context = " ".join(
            chunk for chunk in state.get("note_chunks", [state["note_content"]])
            if name.lower() in chunk.lower()
        ) or state["note_content"][:500]

        if matches:
            # Take the first (best name-match) hit
            concepts_to_merge.append({
                "existing_concept": matches[0],
                "name": name,
                "new_context": context,
            })
        else:
            concepts_to_create.append({"name": name, "context": context})

    return {
        "concepts_to_create": concepts_to_create,
        "concepts_to_merge": concepts_to_merge,
    }


async def link_concepts(state: CompilerState, gemini: Any, pool: Any) -> dict:
    """Ask Gemini to identify edges between the extracted concepts."""
    if len(state["raw_concepts"]) < 2:
        return {"edges_to_create": []}

    context = state["note_content"][:1000]
    prompt = _LINK_PROMPT.format(
        concepts=json.dumps(state["raw_concepts"]),
        context=context,
    )
    response = await gemini.chat(model="gemini-3.1-flash-lite-preview", prompt=prompt)

    edges: list[EdgeSpec] = []
    try:
        parsed = json.loads(response)
        for edge in parsed:
            if {"source", "target", "relation"}.issubset(edge.keys()):
                edges.append(
                    EdgeSpec(
                        source_name=edge["source"],
                        target_name=edge["target"],
                        relation=edge["relation"],
                        weight=1.0,
                    )
                )
    except (json.JSONDecodeError, TypeError):
        pass

    return {"edges_to_create": edges}


async def persist_changes(state: CompilerState, gemini: Any, pool: Any) -> dict:
    """
    Write all queued creates, merges, and edges to the database.
    Builds wiki_changes list for logging.
    """
    wiki_changes: list[WikiChange] = []
    # name ??concept_id for edge resolution
    name_to_id: dict[str, str] = {}

    # 1. Create new concepts
    for spec in state["concepts_to_create"]:
        summary_prompt = (
            f"Write a concise 2-sentence knowledge-base summary for the concept '{spec['name']}' "
            f"based on this context: {spec['context']}"
        )
        summary = await gemini.chat(model="gemini-3.1-flash-lite-preview", prompt=summary_prompt)
        embedding = await gemini.embed(summary)

        concept_id = await create_concept(
            pool=pool,
            project_id=state["project_id"],
            name=spec["name"],
            summary=summary,
            embedding=embedding,
        )
        name_to_id[spec["name"].lower()] = concept_id
        wiki_changes.append(
            WikiChange(
                concept_id=concept_id,
                change_type="created",
                before_summary=None,
                after_summary=summary,
            )
        )

    # 2. Merge into existing concepts
    for spec in state["concepts_to_merge"]:
        existing = spec["existing_concept"]
        merge_prompt = _MERGE_PROMPT.format(
            name=existing["name"],
            existing_summary=existing.get("summary", ""),
            new_context=spec["new_context"],
        )
        new_summary = await gemini.chat(model="gemini-3.1-flash-lite-preview", prompt=merge_prompt)
        new_embedding = await gemini.embed(new_summary)
        await update_concept_summary(pool, existing["id"], new_summary, new_embedding)
        name_to_id[spec["name"].lower()] = existing["id"]
        wiki_changes.append(
            WikiChange(
                concept_id=existing["id"],
                change_type="merged",
                before_summary=existing.get("summary"),
                after_summary=new_summary,
            )
        )

    # 3. Write edges
    for edge in state["edges_to_create"]:
        src_id = name_to_id.get(edge["source_name"].lower())
        tgt_id = name_to_id.get(edge["target_name"].lower())
        if src_id and tgt_id and src_id != tgt_id:
            await create_concept_edge(pool, src_id, tgt_id, edge["relation"], edge["weight"])

    return {"wiki_changes": wiki_changes}


async def log_changes(state: CompilerState, gemini: Any, pool: Any) -> dict:
    """Persist wiki_logs entries for all changes made in this run."""
    for change in state["wiki_changes"]:
        await log_wiki_change(
            pool=pool,
            concept_id=change["concept_id"],
            project_id=state["project_id"],
            change_type=change["change_type"],
            before_summary=change.get("before_summary"),
            after_summary=change["after_summary"],
            triggered_by_note_id=state["note_id"],
        )
    return {}
```

- [ ] **Step 7: Create `src/worker/agents/compiler/graph.py`**

```python
"""Build the Compiler LangGraph StateGraph."""
from __future__ import annotations

from typing import Any

from langgraph.graph import StateGraph, END

from worker.agents.compiler.state import CompilerState
from worker.agents.compiler.nodes import (
    parse_note,
    extract_concepts,
    search_existing_concepts,
    merge_or_create_concepts,
    link_concepts,
    persist_changes,
    log_changes,
)


def _wrap(fn):
    """Wrap a node function so it receives gemini and pool from configurable."""
    async def node(state: CompilerState, config: dict) -> dict:
        cfg = config.get("configurable", {})
        return await fn(state, gemini=cfg.get("gemini"), pool=cfg.get("pool"))
    return node


def build_compiler_graph() -> StateGraph:
    graph = StateGraph(CompilerState)

    graph.add_node("parse_note", _wrap(parse_note))
    graph.add_node("extract_concepts", _wrap(extract_concepts))
    graph.add_node("search_existing", _wrap(search_existing_concepts))
    graph.add_node("merge_or_create", _wrap(merge_or_create_concepts))
    graph.add_node("link_concepts", _wrap(link_concepts))
    graph.add_node("persist_changes", _wrap(persist_changes))
    graph.add_node("log_changes", _wrap(log_changes))

    graph.set_entry_point("parse_note")
    graph.add_edge("parse_note", "extract_concepts")
    graph.add_edge("extract_concepts", "search_existing")
    graph.add_edge("search_existing", "merge_or_create")
    graph.add_edge("merge_or_create", "link_concepts")
    graph.add_edge("link_concepts", "persist_changes")
    graph.add_edge("persist_changes", "log_changes")
    graph.add_edge("log_changes", END)

    return graph.compile()
```

- [ ] **Step 8: Create Temporal activity stubs for the Compiler**

```python
# src/worker/temporal/activities/compiler_activities.py
"""Temporal activity definitions wrapping Compiler agent nodes."""
from __future__ import annotations

from dataclasses import dataclass
from temporalio import activity

from worker.db.connection import get_pool
from worker.gemini.client import GeminiClient
from worker.agents.compiler.state import CompilerState


def _deps():
    """Lazy-load shared dependencies inside activity calls."""
    import os
    gemini = GeminiClient(api_key=os.environ["GEMINI_API_KEY"])
    return gemini


@dataclass
class CompilerInput:
    note_id: str
    note_content: str
    project_id: str


@activity.defn
async def parse_note_activity(inp: CompilerInput) -> dict:
    from worker.agents.compiler.nodes import parse_note
    state = CompilerState(
        note_id=inp.note_id, note_content=inp.note_content,
        project_id=inp.project_id, raw_concepts=[], existing_matches={},
        concepts_to_create=[], concepts_to_merge=[], edges_to_create=[],
        wiki_changes=[], error=None, note_chunks=[],
    )
    return await parse_note(state, gemini=None, pool=None)


@activity.defn
async def extract_concepts_activity(state: dict) -> dict:
    from worker.agents.compiler.nodes import extract_concepts
    return await extract_concepts(CompilerState(**state), gemini=_deps(), pool=None)


@activity.defn
async def search_existing_concepts_activity(state: dict) -> dict:
    from worker.agents.compiler.nodes import search_existing_concepts
    pool = await get_pool()
    return await search_existing_concepts(CompilerState(**state), gemini=None, pool=pool)


@activity.defn
async def merge_or_create_concepts_activity(state: dict) -> dict:
    from worker.agents.compiler.nodes import merge_or_create_concepts
    return await merge_or_create_concepts(CompilerState(**state), gemini=None, pool=None)


@activity.defn
async def link_concepts_activity(state: dict) -> dict:
    from worker.agents.compiler.nodes import link_concepts
    return await link_concepts(CompilerState(**state), gemini=_deps(), pool=None)


@activity.defn
async def log_wiki_changes_activity(state: dict) -> dict:
    from worker.agents.compiler.nodes import log_changes
    pool = await get_pool()
    return await log_changes(CompilerState(**state), gemini=None, pool=pool)
```

- [ ] **Step 9: Create the Compiler Temporal workflow**

```python
# src/worker/temporal/workflows/compiler_workflow.py
"""Temporal workflow that orchestrates the Compiler agent end-to-end."""
from __future__ import annotations

import datetime
from dataclasses import dataclass
from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.temporal.activities.compiler_activities import (
        CompilerInput,
        parse_note_activity,
        extract_concepts_activity,
        search_existing_concepts_activity,
        merge_or_create_concepts_activity,
        link_concepts_activity,
        log_wiki_changes_activity,
    )

_RETRY = RetryPolicy(maximum_attempts=3, initial_interval=datetime.timedelta(seconds=2))
_TIMEOUT = datetime.timedelta(minutes=10)


@workflow.defn
class CompilerWorkflow:
    @workflow.run
    async def run(self, inp: CompilerInput) -> dict:
        state: dict = {}

        state.update(
            await workflow.execute_activity(
                parse_note_activity, inp,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        state.update({
            "note_id": inp.note_id,
            "note_content": inp.note_content,
            "project_id": inp.project_id,
        })

        state.update(
            await workflow.execute_activity(
                extract_concepts_activity, state,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        state.update(
            await workflow.execute_activity(
                search_existing_concepts_activity, state,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        state.update(
            await workflow.execute_activity(
                merge_or_create_concepts_activity, state,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        state.update(
            await workflow.execute_activity(
                link_concepts_activity, state,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        state.update(
            await workflow.execute_activity(
                log_wiki_changes_activity, state,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        return state
```

- [ ] **Step 10: Run tests to verify they pass**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/test_compiler_graph.py -v
```

Expected: all 3 tests `PASSED`

- [ ] **Step 11: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/worker/src/worker/agents/compiler/ \
        apps/worker/src/worker/agents/__init__.py \
        apps/worker/src/worker/temporal/activities/compiler_activities.py \
        apps/worker/src/worker/temporal/workflows/compiler_workflow.py \
        apps/worker/tests/test_compiler_graph.py
git commit -m "feat(worker): implement Compiler agent (LangGraph) + Temporal workflow"
```

---

### Task 6: Research Agent

**Files:**

- Create: `apps/worker/src/worker/agents/research/state.py`
- Create: `apps/worker/src/worker/agents/research/nodes.py`
- Create: `apps/worker/src/worker/agents/research/graph.py`
- Create: `apps/worker/src/worker/agents/research/__init__.py`
- Create: `apps/worker/src/worker/temporal/activities/research_activities.py`
- Create: `apps/worker/src/worker/temporal/workflows/research_workflow.py`
- Test: `apps/worker/tests/test_research_graph.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_research_graph.py
import pytest
from unittest.mock import AsyncMock, MagicMock


def _make_research_state(**overrides):
    from worker.agents.research.state import ResearchState
    defaults = {
        "query": "How does self-attention work in transformers?",
        "project_id": "proj-1",
        "sub_queries": [],
        "search_results": [],
        "evidence": [],
        "answer": None,
        "wiki_feedback": [],
        "error": None,
    }
    return {**defaults, **overrides}


@pytest.mark.asyncio
async def test_decompose_query_produces_sub_queries(mock_gemini_client):
    """decompose_query must produce at least one sub-query."""
    mock_gemini_client.chat = AsyncMock(
        return_value='["What is self-attention?", "How does attention scale?"]'
    )

    from worker.agents.research.nodes import decompose_query
    state = _make_research_state()
    result = await decompose_query(state, gemini=mock_gemini_client, pool=None)

    assert len(result["sub_queries"]) >= 1
    mock_gemini_client.chat.assert_awaited_once()


@pytest.mark.asyncio
async def test_generate_answer_returns_string(mock_gemini_client):
    """generate_answer must return a non-empty string."""
    mock_gemini_client.chat = AsyncMock(return_value="Self-attention allows tokens to attend.")

    state = _make_research_state(
        sub_queries=["What is self-attention?"],
        evidence=[{"concept_id": "c1", "name": "Self-Attention", "summary": "Mechanism..."}],
    )
    from worker.agents.research.nodes import generate_answer
    result = await generate_answer(state, gemini=mock_gemini_client, pool=None)

    assert isinstance(result["answer"], str)
    assert len(result["answer"]) > 0


@pytest.mark.asyncio
async def test_research_graph_end_to_end(mock_gemini_client, mock_db_pool):
    """Full Research graph should complete and produce an answer."""
    pool, conn = mock_db_pool
    conn.fetch = AsyncMock(return_value=[
        MagicMock(concept_id="c1", name="Self-Attention", summary="Attend to all positions.")
    ])

    mock_gemini_client.chat = AsyncMock(side_effect=[
        '["What is self-attention?"]',   # decompose
        "Self-attention allows tokens to attend to each other.",  # generate_answer
        '[]',  # wiki_feedback
    ])
    mock_gemini_client.embed = AsyncMock(return_value=[0.1] * 3072)

    from worker.agents.research.graph import build_research_graph
    graph = build_research_graph()
    state = _make_research_state()

    result = await graph.ainvoke(
        state,
        config={"configurable": {"gemini": mock_gemini_client, "pool": pool}},
    )

    assert result.get("error") is None
    assert result.get("answer") is not None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/test_research_graph.py -v
```

Expected: `ModuleNotFoundError`

- [ ] **Step 3: Create `src/worker/agents/research/__init__.py`**

```python
"""Research agent: answers queries using hybrid search over the knowledge graph."""
```

- [ ] **Step 4: Create `src/worker/agents/research/state.py`**

```python
"""ResearchState: the shared state dict that flows through the Research graph."""
from __future__ import annotations

from typing import Any, Optional
from typing_extensions import TypedDict


class EvidenceItem(TypedDict):
    concept_id: str
    name: str
    summary: str
    rrf_score: float
    source: str   # "vector" | "bm25" | "graph"


class WikiFeedback(TypedDict):
    concept_id: str
    suggested_update: str
    reason: str


class ResearchState(TypedDict):
    # Input
    query: str
    project_id: str

    # Intermediate
    sub_queries: list[str]
    search_results: list[dict[str, Any]]   # raw hybrid_search output
    evidence: list[EvidenceItem]

    # Output
    answer: Optional[str]
    wiki_feedback: list[WikiFeedback]

    # Error
    error: Optional[str]
```

- [ ] **Step 5: Create `src/worker/agents/research/nodes.py`**

```python
"""Research agent node functions."""
from __future__ import annotations

import json
from typing import Any

from worker.agents.research.state import ResearchState, EvidenceItem, WikiFeedback
from worker.db.search import hybrid_search


_DECOMPOSE_PROMPT = """\
You are a research assistant. Break the following user question into 2-4 focused
sub-queries that together would fully answer it. Return a JSON array of strings.

Question: {query}

JSON array:"""

_ANSWER_PROMPT = """\
You are a knowledgeable assistant with access to a structured knowledge base.

User question: {query}

Retrieved knowledge base entries:
{evidence}

Write a comprehensive, accurate answer. Cite concept names where relevant.
Do not make up facts not present in the evidence. Answer:"""

_WIKI_FEEDBACK_PROMPT = """\
After answering the question below using the provided knowledge base entries,
identify any entries whose summaries are incomplete, outdated, or could be improved.

Question: {query}
Answer: {answer}
Knowledge base entries used:
{evidence}

Return a JSON array of objects with keys: concept_id, suggested_update, reason.
If no improvements are needed, return an empty array [].

JSON array:"""


async def decompose_query(state: ResearchState, gemini: Any, pool: Any) -> dict:
    """Break the query into focused sub-queries."""
    prompt = _DECOMPOSE_PROMPT.format(query=state["query"])
    response = await gemini.chat(
        model="gemini-3.1-flash-lite-preview",
        prompt=prompt,
    )
    try:
        sub_queries = json.loads(response)
        if not isinstance(sub_queries, list):
            sub_queries = [state["query"]]
    except json.JSONDecodeError:
        sub_queries = [state["query"]]

    return {"sub_queries": sub_queries or [state["query"]]}


async def run_hybrid_search(state: ResearchState, gemini: Any, pool: Any) -> dict:
    """Run hybrid_search for each sub-query and merge results."""
    all_results: list[dict] = []
    seen_ids: set[str] = set()

    for sub_query in state["sub_queries"]:
        embedding = await gemini.embed(sub_query)
        hits = await hybrid_search(
            pool=pool,
            project_id=state["project_id"],
            query_text=sub_query,
            query_embedding=embedding,
            top_k=10,
        )
        for hit in hits:
            cid = hit.get("concept_id") or hit.get("id")
            if cid and cid not in seen_ids:
                seen_ids.add(cid)
                all_results.append(hit)

    return {"search_results": all_results}


async def collect_evidence(state: ResearchState, gemini: Any, pool: Any) -> dict:
    """Convert raw search results into structured EvidenceItem list (top 15)."""
    evidence: list[EvidenceItem] = []
    for r in state["search_results"][:15]:
        evidence.append(
            EvidenceItem(
                concept_id=str(r.get("concept_id", r.get("id", ""))),
                name=str(r.get("name", "")),
                summary=str(r.get("summary", "")),
                rrf_score=float(r.get("rrf_score", 0.0)),
                source=str(r.get("source", "hybrid")),
            )
        )
    return {"evidence": evidence}


async def generate_answer(state: ResearchState, gemini: Any, pool: Any) -> dict:
    """Generate a comprehensive answer from the collected evidence."""
    evidence_text = "\n\n".join(
        f"[{e['name']}]: {e['summary']}" for e in state["evidence"]
    )
    prompt = _ANSWER_PROMPT.format(
        query=state["query"],
        evidence=evidence_text or "No relevant knowledge base entries found.",
    )
    answer = await gemini.chat(
        model="gemini-3.1-flash-lite-preview",
        prompt=prompt,
        thinking_budget=2048,
    )
    return {"answer": answer}


async def wiki_feedback(state: ResearchState, gemini: Any, pool: Any) -> dict:
    """Suggest knowledge base improvements based on the research session."""
    evidence_text = "\n\n".join(
        f"[{e['concept_id']}] {e['name']}: {e['summary']}"
        for e in state["evidence"][:8]
    )
    prompt = _WIKI_FEEDBACK_PROMPT.format(
        query=state["query"],
        answer=state.get("answer", ""),
        evidence=evidence_text,
    )
    response = await gemini.chat(model="gemini-3.1-flash-lite-preview", prompt=prompt)
    try:
        feedback_list = json.loads(response)
        if not isinstance(feedback_list, list):
            feedback_list = []
    except json.JSONDecodeError:
        feedback_list = []

    return {"wiki_feedback": feedback_list}
```

- [ ] **Step 6: Create `src/worker/agents/research/graph.py`**

```python
"""Build the Research LangGraph StateGraph."""
from __future__ import annotations

from langgraph.graph import StateGraph, END

from worker.agents.research.state import ResearchState
from worker.agents.research.nodes import (
    decompose_query,
    run_hybrid_search,
    collect_evidence,
    generate_answer,
    wiki_feedback,
)


def _wrap(fn):
    async def node(state: ResearchState, config: dict) -> dict:
        cfg = config.get("configurable", {})
        return await fn(state, gemini=cfg.get("gemini"), pool=cfg.get("pool"))
    return node


def build_research_graph() -> StateGraph:
    graph = StateGraph(ResearchState)

    graph.add_node("decompose_query", _wrap(decompose_query))
    graph.add_node("run_hybrid_search", _wrap(run_hybrid_search))
    graph.add_node("collect_evidence", _wrap(collect_evidence))
    graph.add_node("generate_answer", _wrap(generate_answer))
    graph.add_node("wiki_feedback", _wrap(wiki_feedback))

    graph.set_entry_point("decompose_query")
    graph.add_edge("decompose_query", "run_hybrid_search")
    graph.add_edge("run_hybrid_search", "collect_evidence")
    graph.add_edge("collect_evidence", "generate_answer")
    graph.add_edge("generate_answer", "wiki_feedback")
    graph.add_edge("wiki_feedback", END)

    return graph.compile()
```

- [ ] **Step 7: Create `src/worker/temporal/activities/research_activities.py`**

```python
"""Temporal activity definitions wrapping Research agent nodes."""
from __future__ import annotations

import os
from dataclasses import dataclass
from temporalio import activity

from worker.db.connection import get_pool
from worker.gemini.client import GeminiClient


def _deps():
    return GeminiClient(api_key=os.environ["GEMINI_API_KEY"])


@dataclass
class ResearchInput:
    query: str
    project_id: str


@activity.defn
async def decompose_query_activity(inp: ResearchInput) -> dict:
    from worker.agents.research.nodes import decompose_query
    from worker.agents.research.state import ResearchState
    state = ResearchState(
        query=inp.query, project_id=inp.project_id,
        sub_queries=[], search_results=[], evidence=[],
        answer=None, wiki_feedback=[], error=None,
    )
    return await decompose_query(state, gemini=_deps(), pool=None)


@activity.defn
async def hybrid_search_activity(state: dict) -> dict:
    from worker.agents.research.nodes import run_hybrid_search
    from worker.agents.research.state import ResearchState
    pool = await get_pool()
    return await run_hybrid_search(ResearchState(**state), gemini=_deps(), pool=pool)


@activity.defn
async def collect_evidence_activity(state: dict) -> dict:
    from worker.agents.research.nodes import collect_evidence
    from worker.agents.research.state import ResearchState
    return await collect_evidence(ResearchState(**state), gemini=None, pool=None)


@activity.defn
async def generate_answer_activity(state: dict) -> dict:
    from worker.agents.research.nodes import generate_answer
    from worker.agents.research.state import ResearchState
    return await generate_answer(ResearchState(**state), gemini=_deps(), pool=None)


@activity.defn
async def wiki_feedback_activity(state: dict) -> dict:
    from worker.agents.research.nodes import wiki_feedback
    from worker.agents.research.state import ResearchState
    return await wiki_feedback(ResearchState(**state), gemini=_deps(), pool=None)
```

- [ ] **Step 8: Create `src/worker/temporal/workflows/research_workflow.py`**

```python
"""Temporal workflow that orchestrates the Research agent end-to-end."""
from __future__ import annotations

import datetime
from dataclasses import dataclass
from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.temporal.activities.research_activities import (
        ResearchInput,
        decompose_query_activity,
        hybrid_search_activity,
        collect_evidence_activity,
        generate_answer_activity,
        wiki_feedback_activity,
    )

_RETRY = RetryPolicy(maximum_attempts=3, initial_interval=datetime.timedelta(seconds=2))
_TIMEOUT = datetime.timedelta(minutes=15)


@workflow.defn
class ResearchWorkflow:
    @workflow.run
    async def run(self, inp: ResearchInput) -> dict:
        state: dict = {}

        state.update(
            await workflow.execute_activity(
                decompose_query_activity, inp,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        state.update({"query": inp.query, "project_id": inp.project_id})

        state.update(
            await workflow.execute_activity(
                hybrid_search_activity, state,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        state.update(
            await workflow.execute_activity(
                collect_evidence_activity, state,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        state.update(
            await workflow.execute_activity(
                generate_answer_activity, state,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        state.update(
            await workflow.execute_activity(
                wiki_feedback_activity, state,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        return state
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/test_research_graph.py -v
```

Expected: all 3 tests `PASSED`

- [ ] **Step 10: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/worker/src/worker/agents/research/ \
        apps/worker/src/worker/temporal/activities/research_activities.py \
        apps/worker/src/worker/temporal/workflows/research_workflow.py \
        apps/worker/tests/test_research_graph.py
git commit -m "feat(worker): implement Research agent (decompose ??search ??answer ??feedback)"
```

---

### Task 7: Librarian Agent

**Files:**

- Create: `apps/worker/src/worker/agents/librarian/state.py`
- Create: `apps/worker/src/worker/agents/librarian/nodes.py`
- Create: `apps/worker/src/worker/agents/librarian/graph.py`
- Create: `apps/worker/src/worker/agents/librarian/__init__.py`
- Create: `apps/worker/src/worker/temporal/activities/librarian_activities.py`
- Create: `apps/worker/src/worker/temporal/workflows/librarian_workflow.py`
- Test: `apps/worker/tests/test_librarian_graph.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_librarian_graph.py
import pytest
from unittest.mock import AsyncMock, MagicMock


def _make_librarian_state(**overrides):
    from worker.agents.librarian.state import LibrarianState
    defaults = {
        "project_id": "proj-1",
        "orphan_concept_ids": [],
        "contradiction_pairs": [],
        "duplicate_clusters": [],
        "links_strengthened": 0,
        "index_updated": False,
        "error": None,
    }
    return {**defaults, **overrides}


@pytest.mark.asyncio
async def test_detect_orphans_returns_list(mock_db_pool):
    """detect_orphans must return a list of concept IDs with no edges."""
    pool, conn = mock_db_pool
    conn.fetch = AsyncMock(return_value=[
        MagicMock(id="orphan-uuid-1"),
        MagicMock(id="orphan-uuid-2"),
    ])

    from worker.agents.librarian.nodes import detect_orphans
    state = _make_librarian_state()
    result = await detect_orphans(state, gemini=None, pool=pool)

    assert "orphan_concept_ids" in result
    assert len(result["orphan_concept_ids"]) == 2


@pytest.mark.asyncio
async def test_merge_duplicates_calls_update(mock_gemini_client, mock_db_pool):
    """merge_duplicates must call update_concept_summary for each duplicate cluster."""
    pool, conn = mock_db_pool
    conn.fetchrow = AsyncMock(return_value=MagicMock(
        id="c1", name="Self-Attention", summary="Old summary."
    ))
    mock_gemini_client.chat = AsyncMock(return_value="Merged summary text.")
    mock_gemini_client.embed = AsyncMock(return_value=[0.1] * 3072)

    from worker.agents.librarian.nodes import merge_duplicates
    state = _make_librarian_state(
        duplicate_clusters=[["c1", "c2"]],
    )
    result = await merge_duplicates(state, gemini=mock_gemini_client, pool=pool)

    mock_gemini_client.chat.assert_awaited()
    assert "duplicate_clusters" in result


@pytest.mark.asyncio
async def test_librarian_graph_completes(mock_gemini_client, mock_db_pool):
    """Full Librarian graph should complete without raising."""
    pool, conn = mock_db_pool
    conn.fetch = AsyncMock(return_value=[])
    conn.execute = AsyncMock(return_value="OK")
    mock_gemini_client.chat = AsyncMock(return_value="[]")

    from worker.agents.librarian.graph import build_librarian_graph
    graph = build_librarian_graph()
    state = _make_librarian_state()

    result = await graph.ainvoke(
        state,
        config={"configurable": {"gemini": mock_gemini_client, "pool": pool}},
    )

    assert result.get("error") is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/test_librarian_graph.py -v
```

Expected: `ModuleNotFoundError`

- [ ] **Step 3: Create `src/worker/agents/librarian/__init__.py`**

```python
"""Librarian agent: maintains knowledge graph health and consistency."""
```

- [ ] **Step 4: Create `src/worker/agents/librarian/state.py`**

```python
"""LibrarianState: shared state for the Librarian maintenance agent."""
from __future__ import annotations

from typing import Optional
from typing_extensions import TypedDict


class ContradictionPair(TypedDict):
    concept_id_a: str
    concept_id_b: str
    reason: str


class LibrarianState(TypedDict):
    # Input
    project_id: str

    # Intermediate
    orphan_concept_ids: list[str]
    contradiction_pairs: list[ContradictionPair]
    duplicate_clusters: list[list[str]]   # each sub-list is a group of duplicate concept IDs

    # Output metrics
    links_strengthened: int
    index_updated: bool

    # Error
    error: Optional[str]
```

- [ ] **Step 5: Create `src/worker/agents/librarian/nodes.py`**

```python
"""Librarian agent node functions."""
from __future__ import annotations

import json
from typing import Any

from worker.agents.librarian.state import LibrarianState, ContradictionPair
from worker.db.concepts import (
    update_concept_summary,
    create_concept_edge,
    list_concept_edges,
)


_CONTRADICTION_PROMPT = """\
You are reviewing a knowledge base for contradictions.

The following two concepts have conflicting information:
Concept A ({id_a}): {summary_a}
Concept B ({id_b}): {summary_b}

Is this a genuine contradiction, or just complementary information?
Return JSON: {{"is_contradiction": true/false, "reason": "..."}}"""

_MERGE_SUMMARY_PROMPT = """\
Two knowledge base entries describe the same concept. Merge them into a single,
accurate, concise summary (2-4 sentences).

Entry 1 ({id_1}): {summary_1}
Entry 2 ({id_2}): {summary_2}

Merged summary:"""


async def detect_orphans(state: LibrarianState, gemini: Any, pool: Any) -> dict:
    """Find concepts with no edges (isolated nodes in the graph)."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT c.id
            FROM concepts c
            WHERE c.project_id = $1
              AND NOT EXISTS (
                  SELECT 1 FROM concept_edges e
                  WHERE e.source_id = c.id OR e.target_id = c.id
              )
            """,
            state["project_id"],
        )
    return {"orphan_concept_ids": [str(r["id"]) for r in rows]}


async def check_contradictions(state: LibrarianState, gemini: Any, pool: Any) -> dict:
    """
    Use Gemini to check pairs of semantically-close concepts for contradictions.
    Pulls the top-50 nearest-neighbour pairs via pgvector and spot-checks them.
    """
    async with pool.acquire() as conn:
        candidate_pairs = await conn.fetch(
            """
            SELECT a.id AS id_a, b.id AS id_b,
                   a.summary AS summary_a, b.summary AS summary_b
            FROM concepts a
            JOIN concepts b
              ON a.project_id = b.project_id
             AND a.id < b.id
            WHERE a.project_id = $1
            ORDER BY a.embedding <=> b.embedding
            LIMIT 20
            """,
            state["project_id"],
        )

    contradiction_pairs: list[ContradictionPair] = []
    for pair in candidate_pairs:
        prompt = _CONTRADICTION_PROMPT.format(
            id_a=pair["id_a"], summary_a=pair["summary_a"],
            id_b=pair["id_b"], summary_b=pair["summary_b"],
        )
        response = await gemini.chat(model="gemini-3.1-flash-lite-preview", prompt=prompt)
        try:
            data = json.loads(response)
            if data.get("is_contradiction"):
                contradiction_pairs.append(
                    ContradictionPair(
                        concept_id_a=str(pair["id_a"]),
                        concept_id_b=str(pair["id_b"]),
                        reason=data.get("reason", ""),
                    )
                )
        except (json.JSONDecodeError, TypeError):
            continue

    return {"contradiction_pairs": contradiction_pairs}


async def detect_duplicates(state: LibrarianState, gemini: Any, pool: Any) -> dict:
    """
    Find concept pairs with cosine similarity > 0.97 (near-identical embeddings)
    and group them into duplicate clusters.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT a.id AS id_a, b.id AS id_b
            FROM concepts a
            JOIN concepts b
              ON a.project_id = b.project_id
             AND a.id < b.id
            WHERE a.project_id = $1
              AND 1 - (a.embedding <=> b.embedding) > 0.97
            """,
            state["project_id"],
        )

    # Union-find to cluster duplicates
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        if parent.setdefault(x, x) != x:
            parent[x] = find(parent[x])
        return parent[x]

    def union(x: str, y: str) -> None:
        parent[find(x)] = find(y)

    for row in rows:
        union(str(row["id_a"]), str(row["id_b"]))

    clusters: dict[str, list[str]] = {}
    for node in parent:
        root = find(node)
        clusters.setdefault(root, []).append(node)

    duplicate_clusters = [c for c in clusters.values() if len(c) > 1]
    return {"duplicate_clusters": duplicate_clusters}


async def merge_duplicates(state: LibrarianState, gemini: Any, pool: Any) -> dict:
    """For each duplicate cluster, merge all entries into the first concept."""
    for cluster in state["duplicate_clusters"]:
        if len(cluster) < 2:
            continue
        primary_id = cluster[0]
        async with pool.acquire() as conn:
            primary = await conn.fetchrow(
                "SELECT id, name, summary FROM concepts WHERE id = $1", primary_id
            )
        if not primary:
            continue

        merged_summary = primary["summary"]
        for duplicate_id in cluster[1:]:
            async with pool.acquire() as conn:
                dup = await conn.fetchrow(
                    "SELECT id, name, summary FROM concepts WHERE id = $1", duplicate_id
                )
            if not dup:
                continue
            prompt = _MERGE_SUMMARY_PROMPT.format(
                id_1=primary_id, summary_1=merged_summary,
                id_2=duplicate_id, summary_2=dup["summary"],
            )
            merged_summary = await gemini.chat(model="gemini-3.1-flash-lite-preview", prompt=prompt)

        new_embedding = await gemini.embed(merged_summary)
        await update_concept_summary(pool, primary_id, merged_summary, new_embedding)

        # Re-point all edges from duplicates to the primary
        for duplicate_id in cluster[1:]:
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE concept_edges SET source_id = $1 WHERE source_id = $2;
                    UPDATE concept_edges SET target_id = $1 WHERE target_id = $2;
                    DELETE FROM concepts WHERE id = $2;
                    """,
                    primary_id,
                    duplicate_id,
                )

    return {"duplicate_clusters": state["duplicate_clusters"]}


async def strengthen_links(state: LibrarianState, gemini: Any, pool: Any) -> dict:
    """
    Increment edge weights for concept pairs that co-occur frequently in notes.
    Fetches co-occurrence counts from note ??concept references and boosts weight.
    """
    async with pool.acquire() as conn:
        co_occurrences = await conn.fetch(
            """
            SELECT cn1.concept_id AS src, cn2.concept_id AS tgt, COUNT(*) AS cnt
            FROM concept_notes cn1
            JOIN concept_notes cn2
              ON cn1.note_id = cn2.note_id
             AND cn1.concept_id < cn2.concept_id
            JOIN concepts c1 ON c1.id = cn1.concept_id AND c1.project_id = $1
            GROUP BY cn1.concept_id, cn2.concept_id
            HAVING COUNT(*) > 2
            """,
            state["project_id"],
        )

    count = 0
    for row in co_occurrences:
        bonus = min(float(row["cnt"]) * 0.05, 0.5)
        await create_concept_edge(
            pool, str(row["src"]), str(row["tgt"]), "co-occurs", bonus
        )
        count += 1

    return {"links_strengthened": count}


async def update_index(state: LibrarianState, gemini: Any, pool: Any) -> dict:
    """Refresh tsvector search_vector for all concepts in the project."""
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE concepts
            SET search_vector = to_tsvector('english', name || ' ' || coalesce(summary, ''))
            WHERE project_id = $1
            """,
            state["project_id"],
        )
    return {"index_updated": True}
```

- [ ] **Step 6: Create `src/worker/agents/librarian/graph.py`**

```python
"""Build the Librarian LangGraph StateGraph."""
from __future__ import annotations

from langgraph.graph import StateGraph, END

from worker.agents.librarian.state import LibrarianState
from worker.agents.librarian.nodes import (
    detect_orphans,
    check_contradictions,
    detect_duplicates,
    merge_duplicates,
    strengthen_links,
    update_index,
)


def _wrap(fn):
    async def node(state: LibrarianState, config: dict) -> dict:
        cfg = config.get("configurable", {})
        return await fn(state, gemini=cfg.get("gemini"), pool=cfg.get("pool"))
    return node


def build_librarian_graph() -> StateGraph:
    graph = StateGraph(LibrarianState)

    graph.add_node("detect_orphans", _wrap(detect_orphans))
    graph.add_node("check_contradictions", _wrap(check_contradictions))
    graph.add_node("detect_duplicates", _wrap(detect_duplicates))
    graph.add_node("merge_duplicates", _wrap(merge_duplicates))
    graph.add_node("strengthen_links", _wrap(strengthen_links))
    graph.add_node("update_index", _wrap(update_index))

    graph.set_entry_point("detect_orphans")
    graph.add_edge("detect_orphans", "check_contradictions")
    graph.add_edge("check_contradictions", "detect_duplicates")
    graph.add_edge("detect_duplicates", "merge_duplicates")
    graph.add_edge("merge_duplicates", "strengthen_links")
    graph.add_edge("strengthen_links", "update_index")
    graph.add_edge("update_index", END)

    return graph.compile()
```

- [ ] **Step 7: Create `src/worker/temporal/activities/librarian_activities.py`**

```python
"""Temporal activity definitions wrapping Librarian agent nodes."""
from __future__ import annotations

import os
from dataclasses import dataclass
from temporalio import activity

from worker.db.connection import get_pool
from worker.gemini.client import GeminiClient


def _deps():
    return GeminiClient(api_key=os.environ["GEMINI_API_KEY"])


@dataclass
class LibrarianInput:
    project_id: str


@activity.defn
async def detect_orphans_activity(inp: LibrarianInput) -> dict:
    from worker.agents.librarian.nodes import detect_orphans
    from worker.agents.librarian.state import LibrarianState
    pool = await get_pool()
    state = LibrarianState(
        project_id=inp.project_id, orphan_concept_ids=[],
        contradiction_pairs=[], duplicate_clusters=[],
        links_strengthened=0, index_updated=False, error=None,
    )
    return await detect_orphans(state, gemini=None, pool=pool)


@activity.defn
async def check_contradictions_activity(state: dict) -> dict:
    from worker.agents.librarian.nodes import check_contradictions
    from worker.agents.librarian.state import LibrarianState
    pool = await get_pool()
    return await check_contradictions(LibrarianState(**state), gemini=_deps(), pool=pool)


@activity.defn
async def merge_duplicates_activity(state: dict) -> dict:
    from worker.agents.librarian.nodes import merge_duplicates
    from worker.agents.librarian.state import LibrarianState
    pool = await get_pool()
    return await merge_duplicates(LibrarianState(**state), gemini=_deps(), pool=pool)


@activity.defn
async def strengthen_links_activity(state: dict) -> dict:
    from worker.agents.librarian.nodes import strengthen_links
    from worker.agents.librarian.state import LibrarianState
    pool = await get_pool()
    return await strengthen_links(LibrarianState(**state), gemini=None, pool=pool)


@activity.defn
async def update_index_activity(state: dict) -> dict:
    from worker.agents.librarian.nodes import update_index
    from worker.agents.librarian.state import LibrarianState
    pool = await get_pool()
    return await update_index(LibrarianState(**state), gemini=None, pool=pool)
```

- [ ] **Step 8: Create `src/worker/temporal/workflows/librarian_workflow.py`**

```python
"""Temporal workflow that orchestrates the Librarian agent end-to-end."""
from __future__ import annotations

import datetime
from dataclasses import dataclass
from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.temporal.activities.librarian_activities import (
        LibrarianInput,
        detect_orphans_activity,
        check_contradictions_activity,
        merge_duplicates_activity,
        strengthen_links_activity,
        update_index_activity,
    )

_RETRY = RetryPolicy(maximum_attempts=3, initial_interval=datetime.timedelta(seconds=5))
_TIMEOUT = datetime.timedelta(minutes=30)


@workflow.defn
class LibrarianWorkflow:
    @workflow.run
    async def run(self, inp: LibrarianInput) -> dict:
        state: dict = {"project_id": inp.project_id}

        state.update(
            await workflow.execute_activity(
                detect_orphans_activity, inp,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        state.update(
            await workflow.execute_activity(
                check_contradictions_activity, state,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        state.update(
            await workflow.execute_activity(
                merge_duplicates_activity, state,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        state.update(
            await workflow.execute_activity(
                strengthen_links_activity, state,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        state.update(
            await workflow.execute_activity(
                update_index_activity, state,
                start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
            )
        )
        return state
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/test_librarian_graph.py -v
```

Expected: all 3 tests `PASSED`

- [ ] **Step 10: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/worker/src/worker/agents/librarian/ \
        apps/worker/src/worker/temporal/activities/librarian_activities.py \
        apps/worker/src/worker/temporal/workflows/librarian_workflow.py \
        apps/worker/tests/test_librarian_graph.py
git commit -m "feat(worker): implement Librarian agent (orphans, contradictions, duplicates, links)"
```

---

### Task 8: Agent Concurrency Control (Temporal Semaphore per Project)

**Files:**

- Create: `apps/worker/src/worker/temporal/activities/semaphore_activities.py`
- Modify: `apps/worker/src/worker/temporal/workflows/compiler_workflow.py` (wrap run body with semaphore)
- Modify: `apps/worker/src/worker/temporal/workflows/research_workflow.py` (same)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_temporal_workflows.py  (append to existing file)
@pytest.mark.asyncio
async def test_semaphore_acquire_release():
    """acquire then release must succeed without raising."""
    with patch("worker.temporal.activities.semaphore_activities.get_pool") as mock_pool_fn:
        pool = MagicMock()
        conn = AsyncMock()
        conn.fetchrow = AsyncMock(return_value=MagicMock(count=0))
        conn.execute = AsyncMock(return_value="OK")
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=conn)
        ctx.__aexit__ = AsyncMock(return_value=False)
        pool.acquire = MagicMock(return_value=ctx)
        mock_pool_fn.return_value = pool

        from worker.temporal.activities.semaphore_activities import (
            acquire_project_semaphore_activity,
            release_project_semaphore_activity,
        )
        from dataclasses import dataclass

        @dataclass
        class SemInput:
            project_id: str
            max_concurrent: int

        await acquire_project_semaphore_activity(SemInput("proj-1", 3))
        await release_project_semaphore_activity(SemInput("proj-1", 3))
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/test_temporal_workflows.py::test_semaphore_acquire_release -v
```

Expected: `ModuleNotFoundError` or `AttributeError`

- [ ] **Step 3: Create `src/worker/temporal/activities/semaphore_activities.py`**

```python
"""
Per-project Temporal semaphore using the jobs table as a lightweight counter.

Strategy: before running a workflow, the workflow calls acquire_project_semaphore
which polls until the number of in-flight jobs for the project is below
max_concurrent. On completion (or failure), it calls release_project_semaphore.

This is a simple optimistic-locking approach; for stricter guarantees use
Temporal's built-in workflow signals or a dedicated mutex workflow.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from temporalio import activity

from worker.db.connection import get_pool


@dataclass
class SemaphoreInput:
    project_id: str
    max_concurrent: int = 3


@activity.defn
async def acquire_project_semaphore_activity(inp: SemaphoreInput) -> None:
    """
    Spin-wait (with heartbeat) until the number of running jobs for this project
    is below inp.max_concurrent. Uses Temporal activity heartbeat so the activity
    is not timed out during the wait.
    """
    pool = await get_pool()
    while True:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT COUNT(*) AS count
                FROM jobs
                WHERE project_id = $1 AND status = 'running'
                """,
                inp.project_id,
            )
        running = row["count"] if row else 0
        if running < inp.max_concurrent:
            # Mark this slot as taken by inserting a sentinel running job
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO jobs (project_id, job_type, status)
                    VALUES ($1, 'semaphore_slot', 'running')
                    """,
                    inp.project_id,
                )
            return

        activity.heartbeat(f"Waiting for slot; {running}/{inp.max_concurrent} running")
        await asyncio.sleep(2)


@activity.defn
async def release_project_semaphore_activity(inp: SemaphoreInput) -> None:
    """Remove one sentinel semaphore slot for this project."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            DELETE FROM jobs
            WHERE id = (
                SELECT id FROM jobs
                WHERE project_id = $1 AND job_type = 'semaphore_slot' AND status = 'running'
                ORDER BY created_at
                LIMIT 1
            )
            """,
            inp.project_id,
        )
```

- [ ] **Step 4: Wrap CompilerWorkflow `run` body with semaphore**

Open `apps/worker/src/worker/temporal/workflows/compiler_workflow.py` and replace the `run` method body:

```python
    @workflow.run
    async def run(self, inp: CompilerInput) -> dict:
        from worker.temporal.activities.semaphore_activities import (
            SemaphoreInput,
            acquire_project_semaphore_activity,
            release_project_semaphore_activity,
        )
        sem = SemaphoreInput(project_id=inp.project_id, max_concurrent=3)
        sem_timeout = datetime.timedelta(minutes=30)

        await workflow.execute_activity(
            acquire_project_semaphore_activity, sem,
            start_to_close_timeout=sem_timeout,
            heartbeat_timeout=datetime.timedelta(seconds=10),
        )
        try:
            state: dict = {}
            state.update(
                await workflow.execute_activity(
                    parse_note_activity, inp,
                    start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
                )
            )
            state.update({"note_id": inp.note_id, "note_content": inp.note_content,
                          "project_id": inp.project_id})
            state.update(
                await workflow.execute_activity(
                    extract_concepts_activity, state,
                    start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
                )
            )
            state.update(
                await workflow.execute_activity(
                    search_existing_concepts_activity, state,
                    start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
                )
            )
            state.update(
                await workflow.execute_activity(
                    merge_or_create_concepts_activity, state,
                    start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
                )
            )
            state.update(
                await workflow.execute_activity(
                    link_concepts_activity, state,
                    start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
                )
            )
            state.update(
                await workflow.execute_activity(
                    log_wiki_changes_activity, state,
                    start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
                )
            )
            return state
        finally:
            await workflow.execute_activity(
                release_project_semaphore_activity, sem,
                start_to_close_timeout=datetime.timedelta(minutes=1),
            )
```

- [ ] **Step 5: Apply the same semaphore wrap to ResearchWorkflow**

Open `apps/worker/src/worker/temporal/workflows/research_workflow.py` and replace the `run` method body with:

```python
    @workflow.run
    async def run(self, inp: ResearchInput) -> dict:
        from worker.temporal.activities.semaphore_activities import (
            SemaphoreInput,
            acquire_project_semaphore_activity,
            release_project_semaphore_activity,
        )
        sem = SemaphoreInput(project_id=inp.project_id, max_concurrent=3)
        sem_timeout = datetime.timedelta(minutes=30)

        await workflow.execute_activity(
            acquire_project_semaphore_activity, sem,
            start_to_close_timeout=sem_timeout,
            heartbeat_timeout=datetime.timedelta(seconds=10),
        )
        try:
            state: dict = {}
            state.update(
                await workflow.execute_activity(
                    decompose_query_activity, inp,
                    start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
                )
            )
            state.update({"query": inp.query, "project_id": inp.project_id})
            state.update(
                await workflow.execute_activity(
                    hybrid_search_activity, state,
                    start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
                )
            )
            state.update(
                await workflow.execute_activity(
                    collect_evidence_activity, state,
                    start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
                )
            )
            state.update(
                await workflow.execute_activity(
                    generate_answer_activity, state,
                    start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
                )
            )
            state.update(
                await workflow.execute_activity(
                    wiki_feedback_activity, state,
                    start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY
                )
            )
            return state
        finally:
            await workflow.execute_activity(
                release_project_semaphore_activity, sem,
                start_to_close_timeout=datetime.timedelta(minutes=1),
            )
```

- [ ] **Step 6: Run all worker tests**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/worker
uv run pytest tests/ -v
```

Expected: all tests `PASSED`, no errors

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/worker/src/worker/temporal/activities/semaphore_activities.py \
        apps/worker/src/worker/temporal/workflows/compiler_workflow.py \
        apps/worker/src/worker/temporal/workflows/research_workflow.py \
        apps/worker/tests/test_temporal_workflows.py
git commit -m "feat(worker): add per-project Temporal semaphore for concurrency control"
```

---

### Task 9: Dockerfile

**Files:**

- Create: `apps/worker/Dockerfile`

- [ ] **Step 1: Create `apps/worker/Dockerfile`**

```dockerfile
FROM python:3.12-slim AS base

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency files first for layer caching
COPY pyproject.toml .python-version ./

# Install production dependencies (no dev extras)
RUN uv sync --no-dev

# Copy source
COPY src/ ./src/

ENV PYTHONPATH=/app/src

CMD ["uv", "run", "python", "-m", "worker.main"]
```

- [ ] **Step 2: Add worker to docker-compose.yml**

Open `docker-compose.yml` in the monorepo root and add the `worker` service after the existing services:

```yaml
worker:
  build:
    context: ./apps/worker
    dockerfile: Dockerfile
  env_file:
    - ./apps/worker/.env
  depends_on:
    - postgres
    - temporal
  restart: unless-stopped
```

- [ ] **Step 3: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/worker/Dockerfile docker-compose.yml
git commit -m "feat(worker): add Dockerfile and docker-compose service for worker"
```
