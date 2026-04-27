# Literature Search & Auto-Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a chat-driven academic paper search (arXiv + Semantic Scholar + Crossref + Unpaywall) and auto-import flow that produces note rows via the existing ingest/import pipeline.

**Architecture:** API-side synchronous federation (`GET /api/literature/search` calls external APIs with `Promise.all`), Temporal-based async import (`LitImportWorkflow` modelled on `ImportWorkflow`), chat-first UX with an editor-tab full-results viewer. DOI-keyed dedupe via a new `notes.doi` column.

**Tech Stack:** Hono 4 (API), Drizzle ORM + Postgres (DB), Temporal (worker), Python httpx (fetch PDF/metadata), Next.js + Zustand + Vitest (web), pytest (worker tests)

---

## File Map

### packages/db
- **Modify** `src/schema/enums.ts` — add `"literature_search"` to `importSourceEnum`, `"paper"` to `sourceTypeEnum`
- **Modify** `src/schema/notes.ts` — add `doi text` column
- **Create** `drizzle/0029_literature_search.sql` — migration DDL

### apps/api
- **Create** `src/lib/literature-search.ts` — federation: arXiv + SS + Crossref + Unpaywall fetchers + dedupe
- **Create** `src/routes/literature.ts` — GET search, POST import, GET import status
- **Modify** `src/app.ts` — mount `/api/literature`
- **Modify** `src/routes/internal.ts` — add `doi` field to `internalNoteCreateSchema` + `GET /internal/notes?doi=&workspaceId=` dedupe endpoint
- **Create** `tests/literature-search.test.ts`
- **Create** `tests/literature-import.test.ts`

### apps/worker
- **Create** `src/worker/activities/lit_import_activities.py` — `fetch_paper_metadata`, `lit_dedupe_check`, `create_metadata_note`, `fetch_and_upload_oa_pdf`
- **Create** `src/worker/workflows/lit_import_workflow.py` — `LitImportWorkflow`
- **Modify** `src/worker/temporal_main.py` — register workflow + 4 activities in `build_worker_config()`
- **Create** `src/worker/tools_builtin/literature_search.py` — `literature_search` agent tool
- **Create** `src/worker/tools_builtin/literature_import.py` — `literature_import` agent tool
- **Modify** `src/worker/tools_builtin/__init__.py` — export both tools
- **Create** `tests/test_lit_import_activities.py`

### apps/web
- **Modify** `src/stores/tabs-store.ts` — add `"lit-search"` to `TabMode` union
- **Create** `src/components/tab-shell/viewers/lit-search-viewer.tsx` — full results table + import bar
- **Modify** `src/components/tab-shell/tab-mode-router.tsx` — add `case "lit-search"`
- **Create** `src/components/chat/lit-result-card.tsx` — compact card for chat bubbles
- **Create** `messages/ko/literature.json`
- **Create** `messages/en/literature.json`

---

## Task 1: DB Migration — `notes.doi` + enum values

**Files:**
- Modify: `packages/db/src/schema/enums.ts`
- Modify: `packages/db/src/schema/notes.ts`
- Create: `packages/db/drizzle/0029_literature_search.sql`

- [ ] **Step 1: Add enum values in `enums.ts`**

In `packages/db/src/schema/enums.ts`, update the two enums:

```ts
// Change importSourceEnum to:
export const importSourceEnum = pgEnum("import_source", [
  "google_drive",
  "notion_zip",
  "literature_search",   // ← add
]);

// Change sourceTypeEnum to:
export const sourceTypeEnum = pgEnum("source_type", [
  "manual",
  "pdf",
  "audio",
  "video",
  "image",
  "youtube",
  "web",
  "notion",
  "unknown",
  "canvas",
  "paper",   // ← add
]);
```

- [ ] **Step 2: Add `doi` column to `notes` schema**

In `packages/db/src/schema/notes.ts`, add `doi` after `isAuto`:

```ts
// After:  isAuto: boolean("is_auto").notNull().default(false),
doi: text("doi"),
```

In the same file's table indexes array, add:

```ts
// After the existing index declarations, inside the array:
index("notes_workspace_doi_idx").on(t.workspaceId, t.doi),
```

- [ ] **Step 3: Create migration SQL**

Create `packages/db/drizzle/0029_literature_search.sql`:

```sql
-- Add "literature_search" to import_source enum
ALTER TYPE "public"."import_source" ADD VALUE 'literature_search';

-- Add "paper" to source_type enum
ALTER TYPE "public"."source_type" ADD VALUE 'paper';

-- Add doi column to notes
ALTER TABLE "notes" ADD COLUMN "doi" text;

-- Unique partial index: one note per (workspace, doi), null DOIs exempt
CREATE UNIQUE INDEX "notes_workspace_doi_idx"
  ON "notes" ("workspace_id", "doi")
  WHERE "doi" IS NOT NULL;
```

- [ ] **Step 4: Run migration and generate types**

```bash
pnpm db:migrate
pnpm db:generate
```

Expected: no errors, `notes` table gains `doi text` column.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/enums.ts packages/db/src/schema/notes.ts packages/db/drizzle/0029_literature_search.sql
git commit -m "feat(db): add notes.doi column + literature_search/paper enum values"
```

---

## Task 2: API — Literature Federation Helper

**Files:**
- Create: `apps/api/src/lib/literature-search.ts`

- [ ] **Step 1: Create the federation module**

Create `apps/api/src/lib/literature-search.ts`:

```ts
/**
 * Literature search federation — queries arXiv and Semantic Scholar in
 * parallel, deduplicates by DOI, and resolves open-access PDF URLs via
 * Unpaywall. Crossref fires only when both primary sources return 0 results.
 *
 * All network calls use the global fetch (Node 18+). Rate limiting and auth
 * live at the route layer; this file is pure data transformation.
 */

export interface PaperResult {
  id: string;                      // doi or "arxiv:<id>"
  doi: string | null;
  arxivId: string | null;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  source: "arxiv" | "semantic_scholar" | "crossref";
  openAccessPdfUrl: string | null;
  citationCount: number | null;
  alreadyImported: boolean;        // filled in by route layer, default false here
}

// ─── arXiv ────────────────────────────────────────────────────────────────────

async function queryArxiv(query: string, limit: number): Promise<PaperResult[]> {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("max_results", String(limit));
  url.searchParams.set("sortBy", "relevance");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": `OpenCairn/1.0 (${process.env.UNPAYWALL_EMAIL ?? "contact@opencairn.app"})` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];

  const xml = await res.text();
  return parseArxivAtom(xml);
}

function parseArxivAtom(xml: string): PaperResult[] {
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) ?? [];
  return entries.map((entry) => {
    const arxivId = (entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/) ?? [])[1]?.trim() ?? null;
    const title = decodeXml((entry.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1]?.trim() ?? "Untitled");
    const abstract = decodeXml((entry.match(/<summary>([\s\S]*?)<\/summary>/) ?? [])[1]?.trim() ?? null);
    const yearRaw = (entry.match(/<published>(\d{4})/) ?? [])[1];
    const year = yearRaw ? Number(yearRaw) : null;
    const authors = Array.from(entry.matchAll(/<name>(.*?)<\/name>/g)).map((m) => m[1]);
    // arXiv DOIs are in <arxiv:doi> or <link title="doi" ...>
    const doi = (entry.match(/<arxiv:doi[^>]*>(.*?)<\/arxiv:doi>/) ?? [])[1]?.trim() ?? null;
    const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null;

    return {
      id: doi ?? (arxivId ? `arxiv:${arxivId}` : `unknown:${Math.random()}`),
      doi,
      arxivId,
      title,
      authors,
      year,
      abstract,
      source: "arxiv" as const,
      openAccessPdfUrl: pdfUrl,
      citationCount: null,
      alreadyImported: false,
    };
  });
}

// ─── Semantic Scholar ──────────────────────────────────────────────────────────

async function querySemanticScholar(query: string, limit: number): Promise<PaperResult[]> {
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const headers: Record<string, string> = {
    "User-Agent": "OpenCairn/1.0",
  };
  if (apiKey) headers["x-api-key"] = apiKey;

  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("fields", "title,authors,year,abstract,citationCount,externalIds,openAccessPdf");

  const res = await fetch(url.toString(), {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];

  const json = (await res.json()) as { data?: SSPaper[] };
  return (json.data ?? []).map(ssToResult);
}

interface SSPaper {
  title?: string;
  authors?: { name: string }[];
  year?: number | null;
  abstract?: string | null;
  citationCount?: number | null;
  externalIds?: { DOI?: string; ArXiv?: string };
  openAccessPdf?: { url: string } | null;
}

function ssToResult(p: SSPaper): PaperResult {
  const doi = p.externalIds?.DOI ?? null;
  const arxivId = p.externalIds?.ArXiv ?? null;
  return {
    id: doi ?? (arxivId ? `arxiv:${arxivId}` : `ss:${Math.random()}`),
    doi,
    arxivId,
    title: p.title ?? "Untitled",
    authors: (p.authors ?? []).map((a) => a.name),
    year: p.year ?? null,
    abstract: p.abstract ?? null,
    source: "semantic_scholar" as const,
    openAccessPdfUrl: p.openAccessPdf?.url ?? null,
    citationCount: p.citationCount ?? null,
    alreadyImported: false,
  };
}

// ─── Crossref (fallback only) ──────────────────────────────────────────────────

async function queryCrossref(query: string, limit: number): Promise<PaperResult[]> {
  const email = process.env.CROSSREF_MAILTO ?? "contact@opencairn.app";
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query", query);
  url.searchParams.set("rows", String(limit));
  url.searchParams.set("select", "DOI,title,author,published,abstract");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": `OpenCairn/1.0 (mailto:${email})`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];

  const json = (await res.json()) as { message?: { items?: CrossrefItem[] } };
  return (json.message?.items ?? []).map(crossrefToResult);
}

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string }[];
  published?: { "date-parts"?: [[number, ...number[]]] };
  abstract?: string;
}

function crossrefToResult(item: CrossrefItem): PaperResult {
  const doi = item.DOI ?? null;
  const year = item.published?.["date-parts"]?.[0]?.[0] ?? null;
  const authors = (item.author ?? []).map((a) =>
    [a.given, a.family].filter(Boolean).join(" "),
  );
  return {
    id: doi ?? `crossref:${Math.random()}`,
    doi,
    arxivId: null,
    title: item.title?.[0] ?? "Untitled",
    authors,
    year: year ?? null,
    abstract: item.abstract ? stripHtml(item.abstract) : null,
    source: "crossref" as const,
    openAccessPdfUrl: null,
    citationCount: null,
    alreadyImported: false,
  };
}

// ─── Unpaywall ────────────────────────────────────────────────────────────────

async function resolveOaUrl(doi: string): Promise<string | null> {
  const email = process.env.UNPAYWALL_EMAIL ?? "contact@opencairn.app";
  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { best_oa_location?: { url_for_pdf?: string } | null };
    return json.best_oa_location?.url_for_pdf ?? null;
  } catch {
    return null;
  }
}

// ─── Dedupe + merge ───────────────────────────────────────────────────────────

function mergeResults(arxiv: PaperResult[], ss: PaperResult[]): PaperResult[] {
  const byId = new Map<string, PaperResult>();

  for (const p of arxiv) {
    byId.set(p.id, p);
    if (p.doi) byId.set(p.doi, p);
  }
  for (const p of ss) {
    const key = p.id;
    const existing = byId.get(key) ?? (p.doi ? byId.get(p.doi) : undefined);
    if (existing) {
      // SS wins on citationCount + longer abstract; arXiv wins on PDF URL + arxivId
      existing.citationCount = p.citationCount ?? existing.citationCount;
      if ((p.abstract?.length ?? 0) > (existing.abstract?.length ?? 0)) {
        existing.abstract = p.abstract;
      }
    } else {
      byId.set(key, p);
      if (p.doi) byId.set(p.doi, p);
    }
  }

  // Deduplicate: iterate values, track seen ids
  const seen = new Set<string>();
  const out: PaperResult[] = [];
  for (const p of byId.values()) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

// ─── Unpaywall batch enrichment ───────────────────────────────────────────────

async function enrichWithUnpaywall(results: PaperResult[]): Promise<PaperResult[]> {
  const needsCheck = results.filter((r) => !r.openAccessPdfUrl && r.doi);
  const resolved = await Promise.all(
    needsCheck.map(async (r) => ({
      id: r.id,
      url: await resolveOaUrl(r.doi!),
    })),
  );
  const byId = new Map(resolved.map((r) => [r.id, r.url]));
  return results.map((r) => ({
    ...r,
    openAccessPdfUrl: r.openAccessPdfUrl ?? byId.get(r.id) ?? null,
  }));
}

// ─── Public entry point ───────────────────────────────────────────────────────

export interface FederatedSearchOptions {
  query: string;
  sources?: ("arxiv" | "semantic_scholar" | "crossref")[];
  limit?: number;
}

export interface FederatedSearchResult {
  results: PaperResult[];
  sourceMeta: { name: string; count: number }[];
}

export async function federatedSearch(
  opts: FederatedSearchOptions,
): Promise<FederatedSearchResult> {
  const { query, sources = ["arxiv", "semantic_scholar"], limit = 20 } = opts;

  const doArxiv = sources.includes("arxiv");
  const doSS = sources.includes("semantic_scholar");
  const doCrossref = sources.includes("crossref");

  const [arxivResults, ssResults] = await Promise.all([
    doArxiv ? queryArxiv(query, limit) : Promise.resolve([]),
    doSS ? querySemanticScholar(query, limit) : Promise.resolve([]),
  ]);

  let merged = mergeResults(arxivResults, ssResults);

  if (merged.length === 0 && doCrossref) {
    merged = await queryCrossref(query, limit);
  }

  const enriched = await enrichWithUnpaywall(merged.slice(0, limit));

  return {
    results: enriched,
    sourceMeta: [
      { name: "arxiv", count: arxivResults.length },
      { name: "semantic_scholar", count: ssResults.length },
    ],
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
pnpm --filter @opencairn/api tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/literature-search.ts
git commit -m "feat(api): add literature federation helper (arXiv + SS + Crossref + Unpaywall)"
```

---

## Task 3: API Route — `GET /api/literature/search`

**Files:**
- Create: `apps/api/src/routes/literature.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/tests/literature-search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/literature-search.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import * as litSearch from "../src/lib/literature-search.js";

describe("GET /api/literature/search", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "editor" });
  });

  afterEach(async () => {
    await seed.cleanup();
    vi.restoreAllMocks();
  });

  it("returns federated results for authenticated user", async () => {
    vi.spyOn(litSearch, "federatedSearch").mockResolvedValue({
      results: [
        {
          id: "10.1234/test",
          doi: "10.1234/test",
          arxivId: null,
          title: "Test Paper",
          authors: ["Alice"],
          year: 2023,
          abstract: "Abstract text",
          source: "arxiv",
          openAccessPdfUrl: "https://arxiv.org/pdf/1234.pdf",
          citationCount: 5,
          alreadyImported: false,
        },
      ],
      sourceMeta: [{ name: "arxiv", count: 1 }],
    });

    const app = createApp();
    const res = await app.request(
      `/api/literature/search?q=test&workspaceId=${seed.workspaceId}`,
      {
        headers: { cookie: await signSessionCookie(seed.userId) },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[]; total: number };
    expect(body.results).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("returns 400 when q is missing", async () => {
    const app = createApp();
    const res = await app.request(
      `/api/literature/search?workspaceId=${seed.workspaceId}`,
      { headers: { cookie: await signSessionCookie(seed.userId) } },
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 for unauthenticated requests", async () => {
    const app = createApp();
    const res = await app.request(
      `/api/literature/search?q=test&workspaceId=${seed.workspaceId}`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limit exceeded", async () => {
    vi.spyOn(litSearch, "federatedSearch").mockResolvedValue({
      results: [],
      sourceMeta: [],
    });
    const app = createApp();
    const cookie = await signSessionCookie(seed.userId);

    // Exhaust the 60 req/min limit
    for (let i = 0; i < 60; i++) {
      await app.request(
        `/api/literature/search?q=test&workspaceId=${seed.workspaceId}`,
        { headers: { cookie } },
      );
    }

    const res = await app.request(
      `/api/literature/search?q=test&workspaceId=${seed.workspaceId}`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @opencairn/api test tests/literature-search.test.ts
```

Expected: FAIL — `literature.ts` not found.

- [ ] **Step 3: Create `apps/api/src/routes/literature.ts`**

```ts
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth";
import { checkRateLimit, _resetRateLimits as _resetLitRateLimits } from "../lib/rate-limit";
import { federatedSearch } from "../lib/literature-search";
import { isUuid } from "../lib/validators";
import { canWrite } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

export { _resetLitRateLimits };

const searchSchema = z.object({
  q: z.string().min(1).max(500),
  workspaceId: z.string().uuid(),
  sources: z.string().optional(),   // "arxiv,semantic_scholar"
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const literatureRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/search", zValidator("query", searchSchema), async (c) => {
    const user = c.get("user");
    const { q, workspaceId, sources: sourcesRaw, limit, offset } = c.req.valid("query");

    const rl = checkRateLimit(`lit:search:${workspaceId}`, 60, 60_000);
    if (!rl.allowed) {
      return c.json(
        { error: "Rate limit exceeded", retryAfterSec: rl.retryAfterSec },
        429,
      );
    }

    const sources = (sourcesRaw?.split(",").filter((s) =>
      ["arxiv", "semantic_scholar", "crossref"].includes(s),
    ) ?? ["arxiv", "semantic_scholar"]) as ("arxiv" | "semantic_scholar" | "crossref")[];

    const { results, sourceMeta } = await federatedSearch({ query: q, sources, limit: limit + offset });
    const page = results.slice(offset, offset + limit);

    return c.json({
      results: page,
      total: results.length,
      sources: sourceMeta,
    });
  });
```

- [ ] **Step 4: Mount the route in `app.ts`**

In `apps/api/src/app.ts`, add import and mount:

```ts
// Add import near other route imports:
import { literatureRoutes } from "./routes/literature";

// Add route mount (before the wildcard /api routers):
app.route("/api/literature", literatureRoutes);
```

- [ ] **Step 5: Run tests and confirm they pass**

```bash
pnpm --filter @opencairn/api test tests/literature-search.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/literature.ts apps/api/src/app.ts apps/api/tests/literature-search.test.ts
git commit -m "feat(api): add GET /api/literature/search with federation + rate limit"
```

---

## Task 4: Internal Notes — `doi` field + dedupe query

**Files:**
- Modify: `apps/api/src/routes/internal.ts`

- [ ] **Step 1: Extend `internalNoteCreateSchema` with `doi`**

In `apps/api/src/routes/internal.ts`, find `internalNoteCreateSchema` (around line 1317) and add:

```ts
// Add inside the z.object({...}):
doi: z.string().max(255).nullable().optional(),
```

- [ ] **Step 2: Persist `doi` in the insert**

In the same file, find the `db.insert(notes).values({` block (around line 1385) and add:

```ts
// Add to the values object:
doi: body.doi ?? null,
```

- [ ] **Step 3: Also extend `sourceTypeEnum` in the schema validator**

The existing `internalNoteCreateSchema` has a hardcoded `.enum(["pdf", "audio", ...])`. Add `"paper"` to that list:

```ts
sourceType: z
  .enum(["pdf", "audio", "video", "image", "youtube", "web", "unknown", "notion", "paper"])
  .nullable()
  .optional(),
```

And in `internalNotePatchSchema` (around line 1416), also add `"paper"`:

```ts
sourceType: z
  .enum(["pdf", "audio", "video", "image", "youtube", "web", "unknown", "notion", "paper"])
  .nullable()
  .optional(),
```

- [ ] **Step 4: Add `GET /internal/notes` DOI lookup endpoint**

After the existing `POST /internal/notes` handler, add:

```ts
// GET /internal/notes?workspaceId=<uuid>&doi=<doi>
// Dedupe check: returns { exists: boolean, noteId: string | null }
internal.get("/notes", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const doi = c.req.query("doi");
  if (!workspaceId || !isUuid(workspaceId) || !doi) {
    return c.json({ error: "workspaceId (uuid) and doi are required" }, 400);
  }
  const [row] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.workspaceId, workspaceId), eq(notes.doi, doi)));
  return c.json({ exists: !!row, noteId: row?.id ?? null });
});
```

- [ ] **Step 5: Verify type-check**

```bash
pnpm --filter @opencairn/api tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/internal.ts
git commit -m "feat(api): add doi field to internal notes create + GET /internal/notes dedupe endpoint"
```

---

## Task 5: Worker Activities — `fetch_paper_metadata` + `lit_dedupe_check`

**Files:**
- Create: `apps/worker/src/worker/activities/lit_import_activities.py`
- Create: `apps/worker/tests/test_lit_import_activities.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/worker/tests/test_lit_import_activities.py`:

```python
"""Unit tests for lit_import_activities pure helpers and activity bodies."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch


# ── _normalize_doi ───────────────────────────────────────────────────────────

def test_normalize_doi_strips_url_prefix():
    from worker.activities.lit_import_activities import _normalize_doi
    assert _normalize_doi("https://doi.org/10.1234/test") == "10.1234/test"


def test_normalize_doi_passthrough():
    from worker.activities.lit_import_activities import _normalize_doi
    assert _normalize_doi("10.1234/test") == "10.1234/test"


def test_normalize_doi_none():
    from worker.activities.lit_import_activities import _normalize_doi
    assert _normalize_doi(None) is None


# ── fetch_paper_metadata ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fetch_paper_metadata_arxiv_id():
    from worker.activities.lit_import_activities import fetch_paper_metadata

    mock_resp = {
        "id": "arxiv:1706.03762",
        "doi": None,
        "arxivId": "1706.03762",
        "title": "Attention Is All You Need",
        "authors": ["Vaswani"],
        "year": 2017,
        "abstract": "We propose...",
        "openAccessPdfUrl": "https://arxiv.org/pdf/1706.03762.pdf",
        "citationCount": None,
    }

    with patch(
        "worker.activities.lit_import_activities._fetch_ss_metadata",
        new_callable=AsyncMock,
        return_value=None,
    ), patch(
        "worker.activities.lit_import_activities._fetch_arxiv_metadata",
        new_callable=AsyncMock,
        return_value=mock_resp,
    ):
        result = await fetch_paper_metadata({"ids": ["arxiv:1706.03762"]})
    papers = result["papers"]
    assert len(papers) == 1
    assert papers[0]["title"] == "Attention Is All You Need"
    assert papers[0]["oa_pdf_url"] == "https://arxiv.org/pdf/1706.03762.pdf"


# ── lit_dedupe_check ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_lit_dedupe_check_splits_correctly():
    from worker.activities.lit_import_activities import lit_dedupe_check

    # One DOI already exists, one is fresh
    async def fake_get(path: str) -> dict:
        if "doi=10.already" in path:
            return {"exists": True, "noteId": "note-abc"}
        return {"exists": False, "noteId": None}

    with patch("worker.activities.lit_import_activities.get_internal", new_callable=AsyncMock, side_effect=fake_get):
        result = await lit_dedupe_check({
            "workspace_id": "ws-1",
            "ids": ["10.already", "10.fresh"],
        })

    assert result["skipped"] == ["10.already"]
    assert result["fresh"] == ["10.fresh"]
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/worker && python -m pytest tests/test_lit_import_activities.py -v 2>&1 | head -20
```

Expected: ImportError (module not found yet).

- [ ] **Step 3: Create `lit_import_activities.py`**

Create `apps/worker/src/worker/activities/lit_import_activities.py`:

```python
"""Activities for LitImportWorkflow.

fetch_paper_metadata  — resolves DOI/arXiv ID → metadata + OA PDF url
lit_dedupe_check      — checks workspace for pre-existing DOI notes
create_metadata_note  — creates a paper-meta-only note (paywall case)
fetch_and_upload_oa_pdf — downloads OA PDF → MinIO object key
"""
from __future__ import annotations

import os
import re
from typing import Any

import httpx
from temporalio import activity

from worker.lib.api_client import get_internal, post_internal
from worker.lib.s3 import upload_bytes  # same helper used by drive_activities


# ── Helpers ──────────────────────────────────────────────────────────────────

def _normalize_doi(doi: str | None) -> str | None:
    """Strip https://doi.org/ prefix if present."""
    if doi is None:
        return None
    return re.sub(r"^https?://doi\.org/", "", doi).strip() or None


async def _fetch_arxiv_metadata(arxiv_id: str) -> dict[str, Any] | None:
    url = f"https://export.arxiv.org/api/query?id_list={arxiv_id}&max_results=1"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url)
            r.raise_for_status()
    except httpx.HTTPError:
        return None

    xml = r.text
    title_m = re.search(r"<title>([\s\S]*?)</title>", xml)
    abstract_m = re.search(r"<summary>([\s\S]*?)</summary>", xml)
    year_m = re.search(r"<published>(\d{4})", xml)
    doi_m = re.search(r"<arxiv:doi[^>]*>(.*?)</arxiv:doi>", xml)
    authors = re.findall(r"<name>(.*?)</name>", xml)

    title = (title_m.group(1).strip() if title_m else "Untitled").replace("\n", " ")
    abstract = (abstract_m.group(1).strip() if abstract_m else None)
    doi = _normalize_doi(doi_m.group(1).strip() if doi_m else None)

    return {
        "id": doi or f"arxiv:{arxiv_id}",
        "doi": doi,
        "arxivId": arxiv_id,
        "title": title,
        "authors": authors,
        "year": int(year_m.group(1)) if year_m else None,
        "abstract": abstract,
        "openAccessPdfUrl": f"https://arxiv.org/pdf/{arxiv_id}.pdf",
        "citationCount": None,
    }


async def _fetch_ss_metadata(doi: str) -> dict[str, Any] | None:
    api_key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY")
    headers = {}
    if api_key:
        headers["x-api-key"] = api_key

    url = (
        f"https://api.semanticscholar.org/graph/v1/paper/{doi}"
        "?fields=title,authors,year,abstract,citationCount,openAccessPdf,externalIds"
    )
    try:
        async with httpx.AsyncClient(timeout=10, headers=headers) as client:
            r = await client.get(url)
            if r.status_code == 404:
                return None
            r.raise_for_status()
    except httpx.HTTPError:
        return None

    p = r.json()
    ext = p.get("externalIds") or {}
    arxiv_id = ext.get("ArXiv")
    oa = (p.get("openAccessPdf") or {}).get("url")

    return {
        "id": doi,
        "doi": doi,
        "arxivId": arxiv_id,
        "title": p.get("title", "Untitled"),
        "authors": [a["name"] for a in (p.get("authors") or [])],
        "year": p.get("year"),
        "abstract": p.get("abstract"),
        "openAccessPdfUrl": oa,
        "citationCount": p.get("citationCount"),
    }


async def _resolve_oa_url(doi: str) -> str | None:
    email = os.environ.get("UNPAYWALL_EMAIL", "contact@opencairn.app")
    url = f"https://api.unpaywall.org/v2/{doi}?email={email}"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(url)
            if not r.is_success:
                return None
            best = r.json().get("best_oa_location") or {}
            return best.get("url_for_pdf")
    except httpx.HTTPError:
        return None


# ── Activities ────────────────────────────────────────────────────────────────

@activity.defn(name="fetch_paper_metadata")
async def fetch_paper_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    """Resolve metadata + OA PDF URL for a list of DOI/arXiv IDs.

    payload: { ids: list[str] }   (DOI or "arxiv:<id>")
    returns: { papers: list[PaperNode] }
    Timeout: 2 min.
    """
    ids: list[str] = payload["ids"]
    papers: list[dict[str, Any]] = []

    for raw_id in ids:
        paper: dict[str, Any] | None = None

        if raw_id.startswith("arxiv:"):
            arxiv_id = raw_id[len("arxiv:"):]
            paper = await _fetch_arxiv_metadata(arxiv_id)
        else:
            doi = _normalize_doi(raw_id)
            if doi:
                paper = await _fetch_ss_metadata(doi)
                if paper and not paper.get("openAccessPdfUrl"):
                    paper["openAccessPdfUrl"] = await _resolve_oa_url(doi)

        if paper is None:
            # Skip unresolvable IDs; caller counts them as failed
            continue

        papers.append({
            "doi": paper.get("doi"),
            "arxiv_id": paper.get("arxivId"),
            "title": paper.get("title", "Untitled"),
            "authors": paper.get("authors", []),
            "year": paper.get("year"),
            "abstract": paper.get("abstract"),
            "citation_count": paper.get("citationCount"),
            "oa_pdf_url": paper.get("openAccessPdfUrl"),
            "is_paywalled": paper.get("openAccessPdfUrl") is None,
        })

    return {"papers": papers}


@activity.defn(name="lit_dedupe_check")
async def lit_dedupe_check(payload: dict[str, Any]) -> dict[str, Any]:
    """Check workspace for pre-existing notes with matching DOI/arXiv IDs.

    payload: { workspace_id: str, ids: list[str] }
    returns: { fresh: list[str], skipped: list[str] }
    Timeout: 30 s.
    """
    workspace_id: str = payload["workspace_id"]
    ids: list[str] = payload["ids"]
    fresh: list[str] = []
    skipped: list[str] = []

    for raw_id in ids:
        # Only DOI-keyed notes are dedupeable; arxiv-only IDs always treated as fresh
        if raw_id.startswith("arxiv:"):
            fresh.append(raw_id)
            continue
        doi = _normalize_doi(raw_id) or raw_id
        result = await get_internal(
            f"/api/internal/notes?workspaceId={workspace_id}&doi={doi}"
        )
        if result.get("exists"):
            skipped.append(raw_id)
        else:
            fresh.append(raw_id)

    return {"fresh": fresh, "skipped": skipped}


@activity.defn(name="create_metadata_note")
async def create_metadata_note(payload: dict[str, Any]) -> dict[str, Any]:
    """Create a metadata-only note for a paywalled paper.

    payload: { paper: PaperNode, project_id: str, job_id: str }
    returns: { note_id: str }
    Timeout: 30 s.
    """
    paper = payload["paper"]
    project_id = payload["project_id"]
    job_id = payload["job_id"]

    authors_str = ", ".join(paper.get("authors") or [])
    year = paper.get("year", "")
    abstract = paper.get("abstract") or ""

    # Build a minimal Plate content with a paper_meta block + paywall notice
    plate_content = [
        {
            "type": "paper_meta",
            "doi": paper.get("doi"),
            "arxivId": paper.get("arxiv_id"),
            "title": paper.get("title", "Untitled"),
            "authors": paper.get("authors", []),
            "year": paper.get("year"),
            "abstract": abstract[:1000] if abstract else None,
            "citationCount": paper.get("citation_count"),
            "openAccessUrl": None,
            "isPaywalled": True,
            "importedAt": "",          # filled by DB defaultNow
            "children": [{"text": ""}],
        },
        {
            "type": "p",
            "children": [
                {
                    "text": "이 논문의 OA PDF를 찾지 못했습니다. PDF를 직접 업로드하거나 기관 구독으로 접근하세요.",
                }
            ],
        },
    ]

    content_text = f"{paper.get('title', '')} {authors_str} {year} {abstract[:500]}".strip()

    resp = await post_internal(
        "/api/internal/notes",
        {
            "projectId": project_id,
            "title": paper.get("title", "Untitled"),
            "type": "source",
            "sourceType": "paper",
            "doi": paper.get("doi"),
            "content": plate_content,
            "contentText": content_text,
            "importJobId": job_id,
        },
    )
    return {"note_id": resp["id"]}


@activity.defn(name="fetch_and_upload_oa_pdf")
async def fetch_and_upload_oa_pdf(payload: dict[str, Any]) -> dict[str, Any]:
    """Download OA PDF → upload to MinIO → return object_key.

    payload: { oa_pdf_url: str, job_id: str, paper_id: str }
    returns: { object_key: str }
    Timeout: 5 min. Max PDF: 50 MB.
    """
    oa_url: str = payload["oa_pdf_url"]
    job_id: str = payload["job_id"]
    paper_id: str = payload["paper_id"]   # DOI or arxiv:<id>, used in key

    MAX_BYTES = 50 * 1024 * 1024  # 50 MB

    # SSRF guard: reject RFC-1918, loopback, link-local targets
    _ssrf_guard(oa_url)

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        r = await client.get(oa_url)
        r.raise_for_status()

        # Content-Type check
        ct = r.headers.get("content-type", "")
        if "application/pdf" not in ct and not oa_url.endswith(".pdf"):
            raise ValueError(f"Unexpected content-type from OA URL: {ct}")

        content = await r.aread()
        if len(content) > MAX_BYTES:
            raise ValueError(f"PDF exceeds 50MB limit: {len(content)} bytes")

    # Sanitize paper_id for use in object key
    safe_id = re.sub(r"[^a-zA-Z0-9._-]", "_", paper_id)[:80]
    object_key = f"imports/literature/{job_id}/{safe_id}.pdf"
    await upload_bytes(object_key, content, "application/pdf")

    return {"object_key": object_key}


def _ssrf_guard(url: str) -> None:
    """Raise ValueError for RFC-1918 / loopback / link-local targets."""
    import ipaddress
    import urllib.parse

    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or ""

    private_prefixes = ("10.", "172.16.", "192.168.", "127.", "169.254.", "::1", "0.")
    if any(host.startswith(p) for p in private_prefixes):
        raise ValueError(f"SSRF: blocked private/loopback host: {host}")
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local:
            raise ValueError(f"SSRF: blocked IP: {host}")
    except ValueError as e:
        if "SSRF" in str(e):
            raise
        # hostname, not IP — let httpx resolve it


__all__ = [
    "_normalize_doi",
    "_fetch_arxiv_metadata",
    "_fetch_ss_metadata",
    "fetch_paper_metadata",
    "lit_dedupe_check",
    "create_metadata_note",
    "fetch_and_upload_oa_pdf",
]
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && python -m pytest tests/test_lit_import_activities.py -v
```

Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/activities/lit_import_activities.py apps/worker/tests/test_lit_import_activities.py
git commit -m "feat(worker): add lit_import_activities (fetch_paper_metadata + lit_dedupe_check + create_metadata_note + fetch_and_upload_oa_pdf)"
```

---

## Task 6: Worker — `LitImportWorkflow` + `temporal_main.py` registration

**Files:**
- Create: `apps/worker/src/worker/workflows/lit_import_workflow.py`
- Modify: `apps/worker/src/worker/temporal_main.py`

- [ ] **Step 1: Create `lit_import_workflow.py`**

Create `apps/worker/src/worker/workflows/lit_import_workflow.py`:

```python
"""Temporal workflow: literature import.

Orchestrates metadata fetch → dedupe → per-paper fan-out → finalize.
Modelled on ImportWorkflow — same activity pattern, same task queue.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.workflows.ingest_workflow import IngestInput, IngestWorkflow


_RETRY = RetryPolicy(maximum_attempts=3, backoff_coefficient=2.0)
_SHORT = timedelta(minutes=5)
_MED = timedelta(minutes=10)
_LONG = timedelta(minutes=30)
_PDF_TIMEOUT = timedelta(minutes=5)


@dataclass
class LitImportInput:
    job_id: str
    user_id: str
    workspace_id: str
    ids: list[str]   # DOI or "arxiv:<id>"


@workflow.defn(name="LitImportWorkflow")
class LitImportWorkflow:
    @workflow.run
    async def run(self, inp: LitImportInput) -> dict[str, Any]:
        # 1. Resolve target project
        target = await workflow.execute_activity(
            "resolve_target",
            {"job_id": inp.job_id},
            schedule_to_close_timeout=_SHORT,
            retry_policy=_RETRY,
        )

        # 2. Fetch metadata for all IDs
        meta_result = await workflow.execute_activity(
            "fetch_paper_metadata",
            {"ids": inp.ids},
            schedule_to_close_timeout=_MED,
            retry_policy=_RETRY,
        )
        papers: list[dict[str, Any]] = meta_result["papers"]

        # 3. Final server-side dedupe (IDs → fresh/skipped split)
        doi_ids = [p["doi"] or f"arxiv:{p['arxiv_id']}" for p in papers if p.get("doi") or p.get("arxiv_id")]
        dedupe = await workflow.execute_activity(
            "lit_dedupe_check",
            {"workspace_id": inp.workspace_id, "ids": doi_ids},
            schedule_to_close_timeout=timedelta(seconds=30),
            retry_policy=_RETRY,
        )
        fresh_set = set(dedupe["fresh"])
        fresh_papers = [
            p for p in papers
            if (p.get("doi") or f"arxiv:{p.get('arxiv_id', '')}") in fresh_set
        ]
        skipped_count = len(papers) - len(fresh_papers)

        # 4. Fan-out: OA PDF → IngestWorkflow, or metadata-only note
        tasks = [
            self._handle_paper(inp, paper, target["project_id"])
            for paper in fresh_papers
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        failed_items = sum(1 for r in results if isinstance(r, BaseException))
        completed_items = len(fresh_papers) - failed_items
        error_lines = [
            f"{fresh_papers[i].get('title', '?')}: {type(e).__name__}: {e}"
            for i, e in enumerate(results)
            if isinstance(e, BaseException)
        ][:100]
        error_summary = "\n".join(error_lines) if error_lines else None

        # 5. Finalize
        await workflow.execute_activity(
            "finalize_import_job",
            {
                "job_id": inp.job_id,
                "user_id": inp.user_id,
                "completed_items": completed_items + skipped_count,
                "failed_items": failed_items,
                "total_items": len(papers),
                "error_summary": error_summary,
            },
            schedule_to_close_timeout=_SHORT,
            retry_policy=_RETRY,
        )

        return {
            "total": len(papers),
            "completed": completed_items,
            "skipped": skipped_count,
            "failed": failed_items,
        }

    async def _handle_paper(
        self,
        inp: LitImportInput,
        paper: dict[str, Any],
        project_id: str,
    ) -> str:
        oa_url = paper.get("oa_pdf_url")
        paper_id = paper.get("doi") or (
            f"arxiv:{paper['arxiv_id']}" if paper.get("arxiv_id") else "unknown"
        )

        if oa_url:
            try:
                upload = await workflow.execute_activity(
                    "fetch_and_upload_oa_pdf",
                    {"oa_pdf_url": oa_url, "job_id": inp.job_id, "paper_id": paper_id},
                    schedule_to_close_timeout=_PDF_TIMEOUT,
                    retry_policy=_RETRY,
                )
                await workflow.execute_child_workflow(
                    IngestWorkflow.run,
                    IngestInput(
                        object_key=upload["object_key"],
                        file_name=f"{paper.get('title', 'paper')[:80]}.pdf",
                        mime_type="application/pdf",
                        user_id=inp.user_id,
                        project_id=project_id,
                        note_id=None,
                    ),
                    id=f"ingest-lit-{inp.job_id}-{paper_id[:40]}",
                )
                return "ok"
            except Exception:
                # Graceful degradation: fall back to metadata-only note
                pass

        await workflow.execute_activity(
            "create_metadata_note",
            {"paper": paper, "project_id": project_id, "job_id": inp.job_id},
            schedule_to_close_timeout=timedelta(seconds=30),
            retry_policy=_RETRY,
        )
        return "ok"
```

- [ ] **Step 2: Register in `temporal_main.py`**

In `apps/worker/src/worker/temporal_main.py`:

Add imports at the top of the imports block:

```python
from worker.activities.lit_import_activities import (
    fetch_paper_metadata,
    lit_dedupe_check,
    create_metadata_note,
    fetch_and_upload_oa_pdf,
)
from worker.workflows.lit_import_workflow import LitImportWorkflow
```

In `build_worker_config()`, add to the `workflows` list:

```python
LitImportWorkflow,
```

And add to the `activities` list (after `finalize_import_job`):

```python
# Literature import
fetch_paper_metadata,
lit_dedupe_check,
create_metadata_note,
fetch_and_upload_oa_pdf,
```

- [ ] **Step 3: Verify Python import chain works**

```bash
cd apps/worker && python -c "from worker.workflows.lit_import_workflow import LitImportWorkflow; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/worker/workflows/lit_import_workflow.py apps/worker/src/worker/temporal_main.py
git commit -m "feat(worker): add LitImportWorkflow + register in temporal_main"
```

---

## Task 7: API Route — `POST /api/literature/import` + Status

**Files:**
- Modify: `apps/api/src/routes/literature.ts`
- Create: `apps/api/tests/literature-import.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/literature-import.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import { db, importJobs, eq } from "@opencairn/db";

// Mock Temporal client — we don't want real workflow execution in unit tests
vi.mock("../src/lib/temporal-client.js", () => ({
  getTemporalClient: vi.fn().mockResolvedValue({
    workflow: {
      start: vi.fn().mockResolvedValue(undefined),
    },
  }),
  taskQueue: "ingest",
}));

describe("POST /api/literature/import", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "editor" });
  });

  afterEach(async () => {
    await seed.cleanup();
    vi.restoreAllMocks();
  });

  it("dispatches LitImportWorkflow and returns 202", async () => {
    const app = createApp();
    const res = await app.request("/api/literature/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({
        ids: ["10.1234/test"],
        projectId: seed.projectId,
      }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string; workflowId: string; skipped: string[]; queued: number };
    expect(body.jobId).toBeTruthy();
    expect(body.queued).toBe(1);
    expect(body.skipped).toEqual([]);
  });

  it("returns 400 for empty ids array", async () => {
    const app = createApp();
    const res = await app.request("/api/literature/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({ ids: [], projectId: seed.projectId }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for ids > 50", async () => {
    const app = createApp();
    const res = await app.request("/api/literature/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(seed.userId),
      },
      body: JSON.stringify({
        ids: Array.from({ length: 51 }, (_, i) => `10.${i}/test`),
        projectId: seed.projectId,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 when user cannot write to project", async () => {
    const other = await seedWorkspace({ role: "viewer" });
    const app = createApp();
    const res = await app.request("/api/literature/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await signSessionCookie(other.userId),
      },
      body: JSON.stringify({ ids: ["10.1234/test"], projectId: seed.projectId }),
    });
    expect(res.status).toBe(403);
    await other.cleanup();
  });
});

describe("GET /api/literature/import/:jobId", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "editor" });
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("returns 404 for unknown jobId", async () => {
    const app = createApp();
    const res = await app.request(
      "/api/literature/import/00000000-0000-0000-0000-000000000000",
      { headers: { cookie: await signSessionCookie(seed.userId) } },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @opencairn/api test tests/literature-import.test.ts
```

Expected: FAIL (routes not yet defined).

- [ ] **Step 3: Add import + status routes to `literature.ts`**

In `apps/api/src/routes/literature.ts`, add after the existing imports:

```ts
import { randomUUID } from "node:crypto";
import { db, importJobs, notes, projects, eq, and } from "@opencairn/db";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
```

Then append to the `literatureRoutes` chain:

```ts
  .post("/import", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ ids: string[]; projectId: string }>();

    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return c.json({ error: "ids must be a non-empty array" }, 400);
    }
    if (body.ids.length > 50) {
      return c.json({ error: "ids must contain at most 50 items" }, 400);
    }
    if (!body.projectId || !isUuid(body.projectId)) {
      return c.json({ error: "projectId is required (uuid)" }, 400);
    }
    if (!(await canWrite(user.id, { type: "project", id: body.projectId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, body.projectId));
    if (!proj) return c.json({ error: "Project not found" }, 404);

    const { workspaceId } = proj;

    // Concurrency guard: max 3 running lit-import workflows per workspace
    const running = await db
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(
        and(
          eq(importJobs.workspaceId, workspaceId),
          eq(importJobs.source, "literature_search"),
          eq(importJobs.status, "running"),
        ),
      );
    if (running.length >= 3) {
      return c.json({ error: "Too many concurrent imports — try again shortly" }, 429);
    }

    // Pre-check dedupe: find DOI-keyed ids that already exist
    const doiIds = body.ids.filter((id) => !id.startsWith("arxiv:"));
    const skipped: string[] = [];
    for (const doi of doiIds) {
      const [existing] = await db
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.workspaceId, workspaceId), eq(notes.doi, doi)));
      if (existing) skipped.push(doi);
    }

    const freshIds = body.ids.filter((id) => !skipped.includes(id));
    if (freshIds.length === 0) {
      return c.json({ jobId: null, workflowId: null, skipped, queued: 0 }, 202);
    }

    const jobId = randomUUID();
    const workflowId = `lit-import-${randomUUID()}`;

    await db.insert(importJobs).values({
      id: jobId,
      workspaceId,
      userId: user.id,
      source: "literature_search",
      workflowId,
      sourceMetadata: {
        query: "",
        sources: ["arxiv", "semantic_scholar"],
        selectedIds: freshIds,
        totalResults: body.ids.length,
      },
    });

    const client = await getTemporalClient();
    await client.workflow.start("LitImportWorkflow", {
      taskQueue,
      workflowId,
      args: [
        {
          job_id: jobId,
          user_id: user.id,
          workspace_id: workspaceId,
          ids: freshIds,
        },
      ],
    });

    return c.json({ jobId, workflowId, skipped, queued: freshIds.length }, 202);
  })

  .get("/import/:jobId", async (c) => {
    const user = c.get("user");
    const jobId = c.req.param("jobId");
    if (!isUuid(jobId)) return c.json({ error: "Not found" }, 404);

    const [row] = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, jobId));
    if (!row) return c.json({ error: "Not found" }, 404);
    if (row.userId !== user.id) return c.json({ error: "Forbidden" }, 403);

    return c.json({
      status: row.status,
      totalItems: row.totalItems,
      completedItems: row.completedItems,
      failedItems: row.failedItems,
      finishedAt: row.finishedAt ?? null,
    });
  });
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @opencairn/api test tests/literature-import.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 5: Full API test suite**

```bash
pnpm --filter @opencairn/api test
```

Expected: all tests pass (no regressions).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/literature.ts apps/api/tests/literature-import.test.ts
git commit -m "feat(api): add POST /api/literature/import + GET /api/literature/import/:jobId"
```

---

## Task 8: i18n Keys

**Files:**
- Create: `apps/web/messages/ko/literature.json`
- Create: `apps/web/messages/en/literature.json`

- [ ] **Step 1: Create `messages/ko/literature.json`**

```json
{
  "search": {
    "placeholder": "논문 제목, 저자, 키워드로 검색",
    "button": "검색",
    "reSearch": "다시 검색",
    "resultCount": "{{count}}개 결과",
    "openInEditor": "에디터에서 전체 결과 보기",
    "noResults": "검색 결과가 없습니다.",
    "loading": "검색 중...",
    "error": "검색 중 오류가 발생했습니다."
  },
  "filter": {
    "sources": "소스",
    "arxiv": "arXiv",
    "semanticScholar": "Semantic Scholar",
    "crossref": "Crossref"
  },
  "result": {
    "citations": "인용 {{count}}회",
    "year": "{{year}}년",
    "abstract": "초록",
    "openPdf": "PDF 보기",
    "doiLink": "DOI 링크"
  },
  "badge": {
    "openAccess": "OA",
    "paywalled": "페이월"
  },
  "import": {
    "selected": "{{count}}개 선택됨",
    "button": "가져오기",
    "importing": "가져오는 중...",
    "done": "가져오기 완료",
    "skipped": "{{count}}개는 이미 워크스페이스에 존재하여 건너뜀",
    "skippedNone": "건너뜀 없음",
    "project": "프로젝트",
    "selectProject": "프로젝트 선택",
    "paywallNotice": "OA PDF를 찾지 못했습니다. 직접 업로드하거나 기관 구독으로 접근하세요."
  },
  "tab": {
    "title": "문헌 검색"
  }
}
```

- [ ] **Step 2: Create `messages/en/literature.json`**

```json
{
  "search": {
    "placeholder": "Search by title, author, or keyword",
    "button": "Search",
    "reSearch": "Re-search",
    "resultCount": "{{count}} results",
    "openInEditor": "Open full results in editor",
    "noResults": "No results found.",
    "loading": "Searching...",
    "error": "An error occurred while searching."
  },
  "filter": {
    "sources": "Sources",
    "arxiv": "arXiv",
    "semanticScholar": "Semantic Scholar",
    "crossref": "Crossref"
  },
  "result": {
    "citations": "{{count}} citations",
    "year": "{{year}}",
    "abstract": "Abstract",
    "openPdf": "Open PDF",
    "doiLink": "DOI Link"
  },
  "badge": {
    "openAccess": "OA",
    "paywalled": "Paywalled"
  },
  "import": {
    "selected": "{{count}} selected",
    "button": "Import",
    "importing": "Importing...",
    "done": "Import complete",
    "skipped": "{{count}} already in workspace — skipped",
    "skippedNone": "No items skipped",
    "project": "Project",
    "selectProject": "Select project",
    "paywallNotice": "No OA PDF found. Upload the PDF directly or access via institutional subscription."
  },
  "tab": {
    "title": "Literature Search"
  }
}
```

- [ ] **Step 3: Run i18n parity check**

```bash
pnpm --filter @opencairn/web i18n:parity
```

Expected: `literature.json` keys match between ko and en.

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages/ko/literature.json apps/web/messages/en/literature.json
git commit -m "feat(web): add literature i18n namespace (ko + en)"
```

---

## Task 9: Frontend — `LitResultCard` (Chat Renderer)

**Files:**
- Create: `apps/web/src/components/chat/lit-result-card.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/chat/lit-result-card.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { useTabsStore } from "@/stores/tabs-store";

export interface LitResultCardData {
  id: string;
  doi: string | null;
  arxivId: string | null;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  openAccessPdfUrl: string | null;
  citationCount: number | null;
  alreadyImported: boolean;
}

interface LitResultCardProps {
  papers: LitResultCardData[];
  query: string;
  workspaceId: string;
  projectId?: string;
}

export function LitResultCard({ papers, query, workspaceId, projectId }: LitResultCardProps) {
  const t = useTranslations("literature");
  const openTab = useTabsStore((s) => s.openTab);

  function handleOpenInEditor() {
    openTab({
      kind: "lit_search",
      mode: "lit-search",
      title: t("tab.title"),
      meta: { query, papers, workspaceId, projectId },
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2 text-sm">
      {papers.slice(0, 5).map((paper) => (
        <div key={paper.id} className="space-y-0.5">
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground mt-0.5">📄</span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">{paper.title}</p>
              <p className="text-muted-foreground text-xs truncate">
                {paper.authors.slice(0, 3).join(", ")}
                {paper.authors.length > 3 && " et al."}
                {paper.year ? ` · ${t("result.year", { year: paper.year })}` : ""}
                {paper.citationCount != null
                  ? ` · ${t("result.citations", { count: paper.citationCount })}`
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {paper.openAccessPdfUrl ? (
                <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded font-medium">
                  {t("badge.openAccess")}
                </span>
              ) : (
                <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">
                  {t("badge.paywalled")}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
      {papers.length > 5 && (
        <p className="text-xs text-muted-foreground pl-6">
          +{papers.length - 5}개 더...
        </p>
      )}
      <div className="pt-1 border-t border-border">
        <button
          onClick={handleOpenInEditor}
          className="text-xs text-primary hover:underline"
        >
          {t("search.openInEditor")} →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Check tsc**

```bash
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: no errors (it's okay if `lit_search` kind causes a TS error — we'll fix that in the next task).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/chat/lit-result-card.tsx
git commit -m "feat(web): add LitResultCard chat bubble component"
```

---

## Task 10: Frontend — `LitSearchResultsViewer` + `TabModeRouter` + `tabs-store`

**Files:**
- Modify: `apps/web/src/stores/tabs-store.ts`
- Create: `apps/web/src/components/tab-shell/viewers/lit-search-viewer.tsx`
- Modify: `apps/web/src/components/tab-shell/tab-mode-router.tsx`

- [ ] **Step 1: Add `"lit-search"` to `TabMode` + `"lit_search"` to `TabKind`**

In `apps/web/src/stores/tabs-store.ts`, update the two type unions:

```ts
// Add "lit_search" to TabKind:
export type TabKind =
  | "dashboard"
  | "project"
  | "note"
  | "research_hub"
  | "research_run"
  | "import"
  | "ws_settings"
  | "lit_search";    // ← add

// Add "lit-search" to TabMode:
export type TabMode =
  | "plate"
  | "reading"
  | "diff"
  | "artifact"
  | "presentation"
  | "data"
  | "spreadsheet"
  | "whiteboard"
  | "source"
  | "canvas"
  | "graph"
  | "mindmap"
  | "flashcard"
  | "lit-search";    // ← add
```

- [ ] **Step 2: Create `lit-search-viewer.tsx`**

Create `apps/web/src/components/tab-shell/viewers/lit-search-viewer.tsx`:

```tsx
"use client";
import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";
import type { LitResultCardData } from "@/components/chat/lit-result-card";

interface LitSearchMeta {
  query: string;
  papers: LitResultCardData[];
  workspaceId: string;
  projectId?: string;
}

interface LitSearchViewerProps {
  tab: Tab;
}

export function LitSearchViewer({ tab }: LitSearchViewerProps) {
  const t = useTranslations("literature");
  const meta = (tab.meta ?? {}) as LitSearchMeta;

  const [query, setQuery] = useState(meta.query ?? "");
  const [papers, setPapers] = useState<LitResultCardData[]>(meta.papers ?? []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [projectId, setProjectId] = useState(meta.projectId ?? "");
  const [skippedCount, setSkippedCount] = useState(0);
  const [importDone, setImportDone] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !meta.workspaceId) return;
    setLoading(true);
    setImportDone(false);
    try {
      const res = await fetch(
        `/api/literature/search?q=${encodeURIComponent(query)}&workspaceId=${meta.workspaceId}&limit=50`,
        { credentials: "include" },
      );
      if (res.ok) {
        const data = (await res.json()) as { results: LitResultCardData[] };
        setPapers(data.results);
        setSelected(new Set());
      }
    } finally {
      setLoading(false);
    }
  }, [query, meta.workspaceId]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = async () => {
    if (selected.size === 0 || !projectId) return;
    setImporting(true);
    try {
      const res = await fetch("/api/literature/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: Array.from(selected), projectId }),
      });
      if (res.ok) {
        const data = (await res.json()) as { skipped: string[]; queued: number };
        setSkippedCount(data.skipped.length);
        setImportDone(true);
        setSelected(new Set());
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="p-3 border-b border-border flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder={t("search.placeholder")}
          className="flex-1 bg-background border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? t("search.loading") : t("search.button")}
        </button>
      </div>

      {/* Results table */}
      <div className="flex-1 overflow-y-auto">
        {papers.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground text-center mt-8">{t("search.noResults")}</p>
        )}
        {papers.map((paper) => (
          <div
            key={paper.id}
            className="flex items-start gap-3 px-4 py-3 border-b border-border hover:bg-accent/5 cursor-pointer"
            onClick={() => toggleSelect(paper.id)}
          >
            <input
              type="checkbox"
              checked={selected.has(paper.id)}
              onChange={() => toggleSelect(paper.id)}
              className="mt-1 accent-primary"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground line-clamp-1">{paper.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {paper.authors.slice(0, 3).join(", ")}
                {paper.authors.length > 3 ? " et al." : ""}
                {paper.year ? ` · ${paper.year}` : ""}
                {paper.citationCount != null ? ` · ${t("result.citations", { count: paper.citationCount })}` : ""}
              </p>
              {paper.abstract && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{paper.abstract}</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {paper.openAccessPdfUrl ? (
                <>
                  <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded font-medium">
                    {t("badge.openAccess")}
                  </span>
                  <a
                    href={paper.openAccessPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    PDF
                  </a>
                </>
              ) : (
                <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">
                  {t("badge.paywalled")}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Import bar */}
      <div className="p-3 border-t border-border flex items-center gap-3">
        {importDone && skippedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("import.skipped", { count: skippedCount })}
          </p>
        )}
        {importDone && skippedCount === 0 && (
          <p className="text-xs text-green-600 dark:text-green-400">{t("import.done")}</p>
        )}
        <span className="text-sm text-muted-foreground ml-auto">
          {t("import.selected", { count: selected.size })}
        </span>
        <input
          type="text"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          placeholder={t("import.selectProject")}
          className="w-48 bg-background border border-input rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={handleImport}
          disabled={selected.size === 0 || !projectId || importing}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
        >
          {importing ? t("import.importing") : t("import.button")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Register in `tab-mode-router.tsx`**

In `apps/web/src/components/tab-shell/tab-mode-router.tsx`, add import and case:

```tsx
// Add import:
import { LitSearchViewer } from "./viewers/lit-search-viewer";

// Add case before `default`:
case "lit-search":
  return <LitSearchViewer tab={tab} />;
```

- [ ] **Step 4: Full web type-check**

```bash
pnpm --filter @opencairn/web tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/tabs-store.ts \
  apps/web/src/components/tab-shell/viewers/lit-search-viewer.tsx \
  apps/web/src/components/tab-shell/tab-mode-router.tsx
git commit -m "feat(web): add LitSearchViewer tab + TabMode lit-search + TabKind lit_search"
```

---

## Task 11: Agent Tools — `literature_search` + `literature_import`

**Files:**
- Create: `apps/worker/src/worker/tools_builtin/literature_search.py`
- Create: `apps/worker/src/worker/tools_builtin/literature_import.py`
- Modify: `apps/worker/src/worker/tools_builtin/__init__.py`

- [ ] **Step 1: Add internal literature endpoints to `apps/api/src/routes/internal.ts`**

Agent tools use `get_internal`/`post_internal` (internal secret, no user session). Add two endpoints after the existing `/internal/notes` block:

```ts
// GET /internal/literature/search?q=&workspaceId=&limit=&sources=
// Called by the literature_search agent tool
internal.get("/literature/search", async (c) => {
  const q = c.req.query("q");
  const workspaceId = c.req.query("workspaceId");
  const limitRaw = c.req.query("limit");
  const sources = c.req.query("sources");
  if (!q || !workspaceId || !isUuid(workspaceId)) {
    return c.json({ error: "q and workspaceId (uuid) required" }, 400);
  }
  const limit = Math.min(Number(limitRaw) || 10, 50);
  const srcList = (sources?.split(",").filter((s) =>
    ["arxiv", "semantic_scholar", "crossref"].includes(s),
  ) ?? ["arxiv", "semantic_scholar"]) as ("arxiv" | "semantic_scholar" | "crossref")[];

  const { results, sourceMeta } = await federatedSearch({ query: q, sources: srcList, limit });
  return c.json({ results, total: results.length, sources: sourceMeta });
});

// POST /internal/literature/import
// Called by the literature_import agent tool (provides userId + workspaceId from context)
internal.post("/literature/import", async (c) => {
  const body = await c.req.json<{ ids: string[]; projectId: string; userId: string; workspaceId: string }>();
  if (!body.ids?.length || body.ids.length > 50) {
    return c.json({ error: "ids must be 1–50 items" }, 400);
  }
  if (!isUuid(body.projectId) || !isUuid(body.workspaceId) || !body.userId) {
    return c.json({ error: "projectId, workspaceId, userId required" }, 400);
  }
  const skipped: string[] = [];
  for (const id of body.ids.filter((id) => !id.startsWith("arxiv:"))) {
    const [existing] = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.workspaceId, body.workspaceId), eq(notes.doi, id)));
    if (existing) skipped.push(id);
  }
  const freshIds = body.ids.filter((id) => !skipped.includes(id));
  if (freshIds.length === 0) {
    return c.json({ jobId: null, workflowId: null, skipped, queued: 0 }, 202);
  }
  const jobId = randomUUID();
  const workflowId = `lit-import-${randomUUID()}`;
  await db.insert(importJobs).values({
    id: jobId,
    workspaceId: body.workspaceId,
    userId: body.userId,
    source: "literature_search",
    workflowId,
    sourceMetadata: { selectedIds: freshIds },
  });
  const client = await getTemporalClient();
  await client.workflow.start("LitImportWorkflow", {
    taskQueue,
    workflowId,
    args: [{ job_id: jobId, user_id: body.userId, workspace_id: body.workspaceId, ids: freshIds }],
  });
  return c.json({ jobId, workflowId, skipped, queued: freshIds.length }, 202);
});
```

Also add these imports at the top of `internal.ts` (alongside existing imports):
```ts
import { federatedSearch } from "../lib/literature-search";
import { taskQueue } from "../lib/temporal-client";
```

- [ ] **Step 2: Create `literature_search.py`**

Create `apps/worker/src/worker/tools_builtin/literature_search.py`:

```python
"""`literature_search` agent tool — federated paper search via internal API."""
from __future__ import annotations

from urllib.parse import urlencode

from runtime.tools import ToolContext, tool
from worker.lib.api_client import get_internal


@tool(name="literature_search", allowed_scopes=())
async def literature_search(
    query: str,
    ctx: ToolContext,
    limit: int = 10,
    sources: str = "arxiv,semantic_scholar",
) -> dict:
    """Search academic papers from arXiv and Semantic Scholar.

    Returns a list of papers with title, authors, year, citation count,
    and whether an open-access PDF is available.

    Args:
        query: Search terms (title, author, keyword, or concept).
        limit: Number of results to return (max 50, default 10).
        sources: Comma-separated sources. Options: arxiv, semantic_scholar, crossref.
    """
    params = urlencode({
        "q": query,
        "workspaceId": ctx.workspace_id,
        "limit": min(limit, 50),
        "sources": sources,
    })
    result = await get_internal(f"/api/internal/literature/search?{params}")
    papers = result.get("results", [])
    return {
        "papers": [
            {
                "id": p["id"],
                "title": p["title"],
                "authors": p.get("authors", [])[:3],
                "year": p.get("year"),
                "citationCount": p.get("citationCount"),
                "openAccess": p.get("openAccessPdfUrl") is not None,
                "source": p.get("source"),
                "doi": p.get("doi"),
                "arxivId": p.get("arxivId"),
            }
            for p in papers
        ],
        "total": result.get("total", len(papers)),
    }
```

- [ ] **Step 3: Create `literature_import.py`**

Create `apps/worker/src/worker/tools_builtin/literature_import.py`:

```python
"""`literature_import` agent tool — dispatches LitImportWorkflow via internal API."""
from __future__ import annotations

from runtime.tools import ToolContext, tool
from worker.lib.api_client import post_internal


@tool(name="literature_import", allowed_scopes=("project",))
async def literature_import(
    ids: list[str],
    ctx: ToolContext,
) -> dict:
    """Import selected papers into the current project workspace.

    Fetches available open-access PDFs and creates notes. Paywalled
    papers get metadata-only notes with a notice to upload the PDF manually.

    Args:
        ids: List of paper IDs to import (DOI strings or "arxiv:<id>").
    """
    if not ids:
        return {"error": "No IDs provided", "queued": 0}
    if len(ids) > 50:
        return {"error": "Cannot import more than 50 papers at once", "queued": 0}
    if not ctx.project_id:
        return {"error": "project scope required", "queued": 0}

    result = await post_internal(
        "/api/internal/literature/import",
        {
            "ids": ids,
            "projectId": ctx.project_id,
            "userId": ctx.user_id,
            "workspaceId": ctx.workspace_id,
        },
    )
    return {
        "jobId": result.get("jobId"),
        "queued": result.get("queued", 0),
        "skipped": result.get("skipped", []),
        "message": (
            f"{result.get('queued', 0)}개 논문 가져오기 시작됨"
            + (f", {len(result.get('skipped', []))}개 중복으로 건너뜀" if result.get("skipped") else "")
        ),
    }
```

- [ ] **Step 3: Register both tools in `__init__.py`**

In `apps/worker/src/worker/tools_builtin/__init__.py`, add imports and exports:

```python
# Add to imports:
from .literature_search import literature_search
from .literature_import import literature_import

# Add to BUILTIN_TOOLS tuple:
BUILTIN_TOOLS: tuple = (
    list_project_topics,
    search_concepts,
    search_notes,
    read_note,
    fetch_url,
    emit_structured_output,
    get_concept_graph,
    literature_search,    # ← add
    literature_import,    # ← add
)

# Add to __all__:
"literature_search",
"literature_import",
```

- [ ] **Step 4: Verify Python imports**

```bash
cd apps/worker && python -c "from worker.tools_builtin import literature_search, literature_import; print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/tools_builtin/literature_search.py \
  apps/worker/src/worker/tools_builtin/literature_import.py \
  apps/worker/src/worker/tools_builtin/__init__.py
git commit -m "feat(worker): add literature_search + literature_import agent tools"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Run full API test suite**

```bash
pnpm --filter @opencairn/api test
```

Expected: all tests pass.

- [ ] **Step 2: Run worker tests**

```bash
cd apps/worker && python -m pytest tests/ -v --tb=short 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 3: Run web type-check + i18n parity**

```bash
pnpm --filter @opencairn/web tsc --noEmit
pnpm --filter @opencairn/web i18n:parity
```

Expected: no TS errors, parity OK.

- [ ] **Step 4: Build check**

```bash
pnpm --filter @opencairn/web build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Commit any fixes, then tag the feature complete**

```bash
git commit -m "chore: literature search & import feature complete"
```
