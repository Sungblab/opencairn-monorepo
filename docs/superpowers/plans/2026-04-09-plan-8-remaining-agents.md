# Plan 8: Remaining Agents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ 아키텍처 전면 재조정 (2026-04-14):** 본 plan은 원래 TypeScript/Hono + BullMQ + Supabase Storage 전제로 작성됐으나 Plan 4 결정 및 이번 세션 결정에 따라 **전면 교체**:
> - **위치**: `apps/api/src/routes/agents/` (Hono TypeScript) → **`apps/worker/src/worker/agents/`** (Python LangGraph)
> - **실행**: BullMQ → **Temporal Python SDK activity**
> - **스토리지**: Supabase Storage → **Cloudflare R2** (`apps/worker/src/worker/lib/r2_client.py`)
> - **LLM 호출**: `@google/genai` (TS) → **`packages/llm` get_provider()** (Python, Gemini/OpenAI/Ollama 추상화)
> - **검색**: pgvector 직접 호출 → **LightRAG hybrid search** (`mode="hybrid|local|global"`)
> - **Narrator TTS**: `provider.tts()` 호출 (Gemini 전용, 로컬/OpenAI 모드는 graceful degrade)
> - **Deep Research**: Gemini Deep Research API는 Gemini provider 전용 기능, `provider.deep_research()` (graceful degrade로 일반 웹검색 + RAG fallback)
> - **Visualization Agent 추가**: 7개 에이전트로 확장 (원래 6개 + Visualization)
> - 아래 기존 Hono/TypeScript/BullMQ task 목록은 **deprecated** — Python + Temporal 기준으로 재작성 필요

**Goal:** Implement the seven remaining AI agents as Python LangGraph workflows running as Temporal activities: **Connector** (cross-project link suggestion), **Temporal** (stale knowledge detection + review reminders, 시간 기반 쿼리/타임라인), **Synthesis** (여러 노드 → 에세이 생성, cross-domain analogical reasoning), **Curator** (고아/모순/중복 감지, Gemini Search Grounding 기반 소스 추천), **Narrator** (multi-speaker podcast 오디오 생성), **Deep Research** (Gemini Deep Research API 또는 fallback 웹검색 기반 심층 조사), **Visualization** (사용자 뷰 요청 처리 — mindmap/timeline/canvas 자동 배치).

**Architecture:** 각 에이전트는 `apps/worker/src/worker/agents/<agent>_agent.py` 파일로 Python LangGraph StateGraph 구현. Temporal workflow는 `apps/worker/src/worker/workflows/agent_workflows.py`에 정의. API는 `apps/api/src/routes/agents/*.ts` 에서 Temporal client로 workflow 트리거. 결과는 비동기 콜백으로 API가 DB 업데이트 → Hocuspocus broadcast → 프론트엔드 실시간 반영. LLM 호출은 전부 `packages/llm` get_provider()로 추상화. 검색은 LightRAG hybrid API 사용. 오디오는 `provider.tts()` → Cloudflare R2 업로드 → DB에 signed URL 저장.

**Tech Stack:** Python 3.12, LangGraph 0.3, Pydantic AI, Temporal Python SDK, `packages/llm` (Gemini/OpenAI/Ollama 추상화), LightRAG, asyncpg, boto3 (R2), Hono 4 (API 라우트만)

---

## File Structure

```
apps/api/src/
  routes/agents/
    connector.ts          -- POST /agents/connector  (suggest cross-project links)
    temporal.ts           -- POST /agents/temporal   (stale detection + reminders)
    synthesis.ts          -- POST /agents/synthesis  (cross-domain analogy)
    curator.ts            -- POST /agents/curator    (search grounding + sources)
    narrator.ts           -- POST /agents/narrator   (podcast audio generation)
    deep-research.ts      -- POST /agents/deep-research, GET /agents/deep-research/:jobId

  jobs/
    connector.job.ts      -- BullMQ worker: embed comparison + link insertion
    temporal.job.ts       -- BullMQ worker: wiki_logs diff + staleness scoring
    synthesis.job.ts      -- BullMQ worker: concept graph traversal + analogy
    curator.job.ts        -- BullMQ worker: grounded search + source upsert
    narrator.job.ts       -- BullMQ worker: script gen + TTS + storage upload
    deep-research.job.ts  -- BullMQ worker: interactions.create() + poll loop

  lib/
    gemini.ts             -- shared Gemini client (GoogleGenAI instance)
    storage.ts            -- Supabase Storage helper (upload, getSignedUrl)
    queues.ts             -- BullMQ queue definitions

packages/db/src/schema/
  agent-results.ts        -- agent_results table (jobId, agentType, payload, status)
  audio-files.ts          -- audio_files table (noteId, storageUrl, duration)
  suggested-links.ts      -- suggested_links table (sourceNoteId, targetNoteId, score)
  stale-alerts.ts         -- stale_alerts table (noteId, staleness_score, reviewed_at)
```

---

### Task 1: Connector Agent (cross-project embedding comparison → suggest links)

**Files:**
- Create: `apps/api/src/routes/agents/connector.ts`
- Create: `apps/api/src/jobs/connector.job.ts`
- Create: `packages/db/src/schema/suggested-links.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Add `suggested_links` table schema**

```typescript
// packages/db/src/schema/suggested-links.ts
import { pgTable, uuid, real, timestamp, boolean } from 'drizzle-orm/pg-core'
import { notes } from './notes'

export const suggestedLinks = pgTable('suggested_links', {
  id:           uuid('id').defaultRandom().primaryKey(),
  sourceNoteId: uuid('source_note_id').notNull().references(() => notes.id, { onDelete: 'cascade' }),
  targetNoteId: uuid('target_note_id').notNull().references(() => notes.id, { onDelete: 'cascade' }),
  score:        real('score').notNull(),           -- cosine similarity 0-1
  accepted:     boolean('accepted').default(false),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
})

export type SuggestedLink    = typeof suggestedLinks.$inferSelect
export type NewSuggestedLink = typeof suggestedLinks.$inferInsert
```

- [ ] **Step 2: Generate and run migration**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm --filter @opencairn/db db:generate
pnpm --filter @opencairn/db db:migrate
```

- [ ] **Step 3: Create the Connector job**

```typescript
// apps/api/src/jobs/connector.job.ts
import { Worker, Job } from 'bullmq'
import { db } from '../lib/db'
import { notes, suggestedLinks } from '@opencairn/db/schema'
import { sql, and, ne, eq, lt } from 'drizzle-orm'
import { connection } from '../lib/queues'

export interface ConnectorJobData {
  noteId: string
  projectId: string
  threshold: number   // cosine similarity threshold, e.g. 0.75
  limit: number       // max suggestions to store
}

export const connectorWorker = new Worker<ConnectorJobData>(
  'connector',
  async (job: Job<ConnectorJobData>) => {
    const { noteId, projectId, threshold, limit } = job.data

    // Fetch the embedding for the source note
    const [source] = await db
      .select({ embedding: notes.embedding })
      .from(notes)
      .where(eq(notes.id, noteId))

    if (!source?.embedding) throw new Error(`Note ${noteId} has no embedding`)

    // Find top similar notes from OTHER projects using pgvector cosine distance
    const similar = await db.execute(sql`
      SELECT
        n.id   AS target_note_id,
        1 - (n.embedding <=> ${source.embedding}::vector) AS score
      FROM notes n
      WHERE
        n.id != ${noteId}
        AND n.project_id != ${projectId}
        AND n.embedding IS NOT NULL
        AND 1 - (n.embedding <=> ${source.embedding}::vector) >= ${threshold}
      ORDER BY n.embedding <=> ${source.embedding}::vector
      LIMIT ${limit}
    `)

    // Upsert suggestions
    if (similar.rows.length === 0) return { inserted: 0 }

    await db
      .insert(suggestedLinks)
      .values(
        similar.rows.map((r: any) => ({
          sourceNoteId: noteId,
          targetNoteId: r.target_note_id as string,
          score: r.score as number,
        }))
      )
      .onConflictDoNothing()

    return { inserted: similar.rows.length }
  },
  { connection }
)
```

- [ ] **Step 4: Create the Connector route**

```typescript
// apps/api/src/routes/agents/connector.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { connectorQueue } from '../../lib/queues'
import { authMiddleware } from '../../middleware/auth'

const ConnectorSchema = z.object({
  noteId:    z.string().uuid(),
  projectId: z.string().uuid(),
  threshold: z.number().min(0).max(1).default(0.75),
  limit:     z.number().int().min(1).max(50).default(10),
})

export const connectorRouter = new Hono()

connectorRouter.post(
  '/',
  authMiddleware,
  zValidator('json', ConnectorSchema),
  async (c) => {
    const body = c.req.valid('json')
    const job  = await connectorQueue.add('run', body, { attempts: 3 })
    return c.json({ jobId: job.id, status: 'queued' }, 202)
  }
)
```

- [ ] **Step 5: Mount route in app.ts**

```typescript
// In apps/api/src/app.ts — add inside the agent routes section:
import { connectorRouter } from './routes/agents/connector'
// ...
agents.route('/connector', connectorRouter)
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/suggested-links.ts \
        apps/api/src/jobs/connector.job.ts \
        apps/api/src/routes/agents/connector.ts \
        apps/api/src/app.ts \
        packages/db/drizzle/
git commit -m "feat(agent): connector — cross-project embedding similarity + link suggestions"
```

---

### Task 2: Temporal Agent (wiki_logs analysis → stale detection → review reminders)

**Files:**
- Create: `apps/api/src/routes/agents/temporal.ts`
- Create: `apps/api/src/jobs/temporal.job.ts`
- Create: `packages/db/src/schema/stale-alerts.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Add `stale_alerts` table**

```typescript
// packages/db/src/schema/stale-alerts.ts
import { pgTable, uuid, real, timestamp, boolean } from 'drizzle-orm/pg-core'
import { notes } from './notes'

export const staleAlerts = pgTable('stale_alerts', {
  id:             uuid('id').defaultRandom().primaryKey(),
  noteId:         uuid('note_id').notNull().references(() => notes.id, { onDelete: 'cascade' }),
  stalenessScore: real('staleness_score').notNull(),  -- 0-1, higher = more stale
  reviewedAt:     timestamp('reviewed_at'),
  dismissed:      boolean('dismissed').default(false),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
})

export type StaleAlert    = typeof staleAlerts.$inferSelect
export type NewStaleAlert = typeof staleAlerts.$inferInsert
```

- [ ] **Step 2: Generate and run migration**

```bash
pnpm --filter @opencairn/db db:generate
pnpm --filter @opencairn/db db:migrate
```

- [ ] **Step 3: Create the Temporal job**

The job implements two modes: (a) **stale scan** — scores each note based on days since last wiki_log edit and Ebbinghaus forgetting curve decay, then upserts stale_alerts; (b) **reminder check** — returns notes due for spaced-repetition review.

```typescript
// apps/api/src/jobs/temporal.job.ts
import { Worker, Job } from 'bullmq'
import { db } from '../lib/db'
import { wikiLogs, staleAlerts, notes } from '@opencairn/db/schema'
import { sql, eq, and, isNull, lt } from 'drizzle-orm'
import { connection } from '../lib/queues'

export interface TemporalJobData {
  projectId: string
  mode: 'stale-scan' | 'review-reminders'
  staleDaysThreshold?: number   // default 30
}

// Ebbinghaus forgetting: R = e^(-t/S) where S = stability factor (days)
function forgettingScore(daysSinceEdit: number, stabilityDays = 14): number {
  return 1 - Math.exp(-daysSinceEdit / stabilityDays)
}

export const temporalWorker = new Worker<TemporalJobData>(
  'temporal',
  async (job: Job<TemporalJobData>) => {
    const { projectId, mode, staleDaysThreshold = 30 } = job.data

    if (mode === 'stale-scan') {
      // Get the most recent edit timestamp per note from wiki_logs
      const rows = await db.execute(sql`
        SELECT
          n.id          AS note_id,
          MAX(wl.created_at) AS last_edited_at,
          EXTRACT(EPOCH FROM (NOW() - MAX(wl.created_at))) / 86400 AS days_since_edit
        FROM notes n
        LEFT JOIN wiki_logs wl ON wl.note_id = n.id
        WHERE n.project_id = ${projectId}
        GROUP BY n.id
        HAVING EXTRACT(EPOCH FROM (NOW() - MAX(wl.created_at))) / 86400 >= ${staleDaysThreshold}
           OR MAX(wl.created_at) IS NULL
      `)

      const upserts = rows.rows.map((r: any) => ({
        noteId:         r.note_id as string,
        stalenessScore: forgettingScore(r.days_since_edit ?? 365),
      }))

      if (upserts.length > 0) {
        await db
          .insert(staleAlerts)
          .values(upserts)
          .onConflictDoUpdate({
            target: staleAlerts.noteId,
            set: { stalenessScore: sql`EXCLUDED.staleness_score` },
          })
      }

      return { scanned: rows.rows.length, flagged: upserts.length }
    }

    if (mode === 'review-reminders') {
      // Return notes with staleness > 0.5 and not yet reviewed or dismissed
      const due = await db
        .select({
          noteId:         staleAlerts.noteId,
          stalenessScore: staleAlerts.stalenessScore,
          createdAt:      staleAlerts.createdAt,
        })
        .from(staleAlerts)
        .innerJoin(notes, eq(notes.id, staleAlerts.noteId))
        .where(
          and(
            eq(notes.projectId, projectId),
            isNull(staleAlerts.reviewedAt),
            eq(staleAlerts.dismissed, false),
            lt(sql`0.5`, staleAlerts.stalenessScore)
          )
        )
        .orderBy(sql`${staleAlerts.stalenessScore} DESC`)
        .limit(20)

      return { reminders: due }
    }

    throw new Error(`Unknown mode: ${mode}`)
  },
  { connection }
)
```

- [ ] **Step 4: Create the Temporal route**

```typescript
// apps/api/src/routes/agents/temporal.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { temporalQueue } from '../../lib/queues'
import { authMiddleware } from '../../middleware/auth'

const TemporalSchema = z.object({
  projectId:           z.string().uuid(),
  mode:                z.enum(['stale-scan', 'review-reminders']),
  staleDaysThreshold:  z.number().int().positive().default(30),
})

export const temporalRouter = new Hono()

temporalRouter.post(
  '/',
  authMiddleware,
  zValidator('json', TemporalSchema),
  async (c) => {
    const body = c.req.valid('json')
    const job  = await temporalQueue.add('run', body, { attempts: 3 })
    return c.json({ jobId: job.id, status: 'queued' }, 202)
  }
)
```

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/stale-alerts.ts \
        apps/api/src/jobs/temporal.job.ts \
        apps/api/src/routes/agents/temporal.ts \
        packages/db/drizzle/
git commit -m "feat(agent): temporal — Ebbinghaus staleness scoring + spaced-repetition reminders"
```

---

### Task 3: Synthesis Agent (cross-domain analogical reasoning)

**Files:**
- Create: `apps/api/src/routes/agents/synthesis.ts`
- Create: `apps/api/src/jobs/synthesis.job.ts`

The Synthesis agent finds structural analogies across domains by: (1) selecting a source concept and its immediate concept-graph neighbors; (2) using pgvector to find semantically similar subgraph patterns in different projects; (3) asking Gemini to articulate the analogy in natural language.

- [ ] **Step 1: Create the Synthesis job**

```typescript
// apps/api/src/jobs/synthesis.job.ts
import { Worker, Job } from 'bullmq'
import { db } from '../lib/db'
import { concepts, conceptEdges, notes, suggestedLinks } from '@opencairn/db/schema'
import { sql, eq, inArray } from 'drizzle-orm'
import { gemini } from '../lib/gemini'
import { connection } from '../lib/queues'

export interface SynthesisJobData {
  conceptId:  string   // source concept to find analogies for
  projectId:  string   // project to search within (can be cross-project if null)
  maxResults: number
}

export const synthesisWorker = new Worker<SynthesisJobData>(
  'synthesis',
  async (job: Job<SynthesisJobData>) => {
    const { conceptId, maxResults = 5 } = job.data

    // 1. Fetch the source concept embedding
    const [source] = await db
      .select({ name: concepts.name, embedding: concepts.embedding, summary: concepts.summary })
      .from(concepts)
      .where(eq(concepts.id, conceptId))

    if (!source?.embedding) throw new Error('Concept has no embedding')

    // 2. Fetch neighbors (1-hop in concept graph)
    const neighborEdges = await db
      .select({ targetId: conceptEdges.targetConceptId })
      .from(conceptEdges)
      .where(eq(conceptEdges.sourceConceptId, conceptId))

    const neighborIds = neighborEdges.map((e) => e.targetId)

    // 3. Find structurally similar concepts in other domains via vector similarity
    const similar = await db.execute(sql`
      SELECT
        c.id,
        c.name,
        c.summary,
        1 - (c.embedding <=> ${source.embedding}::vector) AS similarity
      FROM concepts c
      WHERE
        c.id != ${conceptId}
        AND c.id != ALL(${neighborIds.length ? neighborIds : ['00000000-0000-0000-0000-000000000000']}::uuid[])
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${source.embedding}::vector
      LIMIT ${maxResults}
    `)

    if (similar.rows.length === 0) return { analogies: [] }

    // 4. Ask Gemini to articulate the cross-domain structural analogy
    const targetDescriptions = similar.rows
      .map((r: any, i: number) => `${i + 1}. "${r.name}": ${r.summary ?? 'no summary'}`)
      .join('\n')

    const prompt = `You are an expert in cross-domain analogical reasoning.

Source concept: "${source.name}"
${source.summary ? `Summary: ${source.summary}` : ''}

The following concepts from other domains are structurally similar (by embedding distance):
${targetDescriptions}

For each target concept, write a 2-3 sentence analogy explaining HOW the source and target are structurally similar, what they share in common, and what insight this parallel reveals. Be precise and insightful.

Return a JSON array: [{ "targetName": string, "analogy": string }]`

    const result = await gemini.models.generateContent({
      model:    'gemini-3.1-flash-lite-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config:   { responseMimeType: 'application/json' },
    })

    const analogies = JSON.parse(result.text ?? '[]')
    return { analogies }
  },
  { connection }
)
```

- [ ] **Step 2: Create the Synthesis route**

```typescript
// apps/api/src/routes/agents/synthesis.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { synthesisQueue } from '../../lib/queues'
import { authMiddleware } from '../../middleware/auth'

const SynthesisSchema = z.object({
  conceptId:  z.string().uuid(),
  projectId:  z.string().uuid(),
  maxResults: z.number().int().min(1).max(20).default(5),
})

export const synthesisRouter = new Hono()

synthesisRouter.post(
  '/',
  authMiddleware,
  zValidator('json', SynthesisSchema),
  async (c) => {
    const body = c.req.valid('json')
    const job  = await synthesisQueue.add('run', body, { attempts: 2 })
    return c.json({ jobId: job.id, status: 'queued' }, 202)
  }
)
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/jobs/synthesis.job.ts \
        apps/api/src/routes/agents/synthesis.ts
git commit -m "feat(agent): synthesis — cross-domain analogical reasoning via concept graph + Gemini"
```

---

### Task 4: Curator Agent (Gemini Search Grounding → source recommendation → auto-ingest)

**Files:**
- Create: `apps/api/src/routes/agents/curator.ts`
- Create: `apps/api/src/jobs/curator.job.ts`
- Modify: `apps/api/src/lib/gemini.ts`

The Curator agent uses Gemini's built-in Google Search Grounding tool to find high-quality external sources related to a note or concept, then stores them as reference metadata and optionally auto-ingests the content as new notes.

- [ ] **Step 1: Update shared Gemini client to export the search tool config**

```typescript
// apps/api/src/lib/gemini.ts
import { GoogleGenAI } from '@google/genai'

if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set')

export const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

// Reusable Google Search Grounding tool definition
export const googleSearchTool = {
  googleSearch: {},
} as const
```

- [ ] **Step 2: Create the Curator job**

```typescript
// apps/api/src/jobs/curator.job.ts
import { Worker, Job } from 'bullmq'
import { db } from '../lib/db'
import { notes } from '@opencairn/db/schema'
import { eq } from 'drizzle-orm'
import { gemini, googleSearchTool } from '../lib/gemini'
import { connection } from '../lib/queues'

export interface CuratorJobData {
  noteId:      string
  autoIngest:  boolean   // if true, create new notes from top sources
  maxSources:  number
}

export interface ExternalSource {
  title:   string
  url:     string
  snippet: string
  reason:  string   // why this source is relevant
}

export const curatorWorker = new Worker<CuratorJobData>(
  'curator',
  async (job: Job<CuratorJobData>) => {
    const { noteId, autoIngest, maxSources = 5 } = job.data

    const [note] = await db
      .select({ title: notes.title, content: notes.content, projectId: notes.projectId })
      .from(notes)
      .where(eq(notes.id, noteId))

    if (!note) throw new Error(`Note ${noteId} not found`)

    const prompt = `You are a research curator. Given the following note, find the ${maxSources} most authoritative and relevant external sources.

Note title: "${note.title}"
Note content (excerpt): ${(note.content ?? '').slice(0, 800)}

Use Google Search to find real, high-quality sources. For each source, explain in one sentence why it is relevant. Return a JSON array:
[{ "title": string, "url": string, "snippet": string, "reason": string }]`

    const response = await gemini.models.generateContent({
      model:    'gemini-3.1-flash-lite-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        tools:            [googleSearchTool],
        responseMimeType: 'application/json',
      },
    })

    const sources: ExternalSource[] = JSON.parse(response.text ?? '[]')

    if (autoIngest && sources.length > 0) {
      // Create stub notes for each external source so users can expand them later
      await db.insert(notes).values(
        sources.map((src) => ({
          projectId: note.projectId,
          title:     src.title,
          content:   `Source: ${src.url}\n\n${src.snippet}\n\n---\n*Auto-ingested by Curator Agent. Reason: ${src.reason}*`,
          sourceUrl: src.url,
        }))
      )
    }

    return { sources, autoIngested: autoIngest ? sources.length : 0 }
  },
  { connection }
)
```

- [ ] **Step 3: Create the Curator route**

```typescript
// apps/api/src/routes/agents/curator.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { curatorQueue } from '../../lib/queues'
import { authMiddleware } from '../../middleware/auth'

const CuratorSchema = z.object({
  noteId:     z.string().uuid(),
  autoIngest: z.boolean().default(false),
  maxSources: z.number().int().min(1).max(10).default(5),
})

export const curatorRouter = new Hono()

curatorRouter.post(
  '/',
  authMiddleware,
  zValidator('json', CuratorSchema),
  async (c) => {
    const body = c.req.valid('json')
    const job  = await curatorQueue.add('run', body, { attempts: 2 })
    return c.json({ jobId: job.id, status: 'queued' }, 202)
  }
)
```

- [ ] **Step 4: Ensure `sourceUrl` column exists on notes table**

Add `sourceUrl: text('source_url')` to `packages/db/src/schema/notes.ts` if not already present, then run:

```bash
pnpm --filter @opencairn/db db:generate
pnpm --filter @opencairn/db db:migrate
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/gemini.ts \
        apps/api/src/jobs/curator.job.ts \
        apps/api/src/routes/agents/curator.ts \
        packages/db/src/schema/notes.ts \
        packages/db/drizzle/
git commit -m "feat(agent): curator — Gemini Search Grounding for external source recommendation + auto-ingest"
```

---

### Task 5: Narrator Agent (script generation → Gemini TTS MultiSpeaker → audio file storage)

**Files:**
- Create: `apps/api/src/routes/agents/narrator.ts`
- Create: `apps/api/src/jobs/narrator.job.ts`
- Create: `apps/api/src/lib/storage.ts`
- Create: `packages/db/src/schema/audio-files.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Add `audio_files` table**

```typescript
// packages/db/src/schema/audio-files.ts
import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core'
import { notes } from './notes'

export const audioFiles = pgTable('audio_files', {
  id:         uuid('id').defaultRandom().primaryKey(),
  noteId:     uuid('note_id').notNull().references(() => notes.id, { onDelete: 'cascade' }),
  storageUrl: text('storage_url').notNull(),
  duration:   integer('duration'),   -- seconds
  transcript: text('transcript'),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
})

export type AudioFile    = typeof audioFiles.$inferSelect
export type NewAudioFile = typeof audioFiles.$inferInsert
```

- [ ] **Step 2: Generate and run migration**

```bash
pnpm --filter @opencairn/db db:generate
pnpm --filter @opencairn/db db:migrate
```

- [ ] **Step 3: Create Supabase Storage helper**

```typescript
// apps/api/src/lib/storage.ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BUCKET = 'audio'

export async function uploadAudio(
  path: string,
  buffer: Buffer,
  contentType = 'audio/wav'
): Promise<string> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: true })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}
```

- [ ] **Step 4: Create the Narrator job**

```typescript
// apps/api/src/jobs/narrator.job.ts
import { Worker, Job } from 'bullmq'
import { db } from '../lib/db'
import { notes, audioFiles } from '@opencairn/db/schema'
import { eq } from 'drizzle-orm'
import { gemini } from '../lib/gemini'
import { uploadAudio } from '../lib/storage'
import { connection } from '../lib/queues'

export interface NarratorJobData {
  noteId:  string
  voice1?: string   // Gemini speaker name, e.g. 'Aoede'
  voice2?: string   // Gemini speaker name, e.g. 'Puck'
}

export const narratorWorker = new Worker<NarratorJobData>(
  'narrator',
  async (job: Job<NarratorJobData>) => {
    const { noteId, voice1 = 'Aoede', voice2 = 'Puck' } = job.data

    const [note] = await db
      .select({ title: notes.title, content: notes.content })
      .from(notes)
      .where(eq(notes.id, noteId))

    if (!note) throw new Error(`Note ${noteId} not found`)

    // Step 1: Generate a two-speaker podcast script from the note content
    const scriptPrompt = `Convert this knowledge note into an engaging 2-speaker podcast dialogue.
Speaker A (the curious learner) asks questions; Speaker B (the domain expert) explains clearly.
Keep it under 400 words total. Use natural spoken language.

Note title: "${note.title}"
Content: ${(note.content ?? '').slice(0, 2000)}

Format output as alternating lines:
A: [Speaker A line]
B: [Speaker B line]`

    const scriptResponse = await gemini.models.generateContent({
      model:    'gemini-3.1-flash-lite-preview',
      contents: [{ role: 'user', parts: [{ text: scriptPrompt }] }],
    })

    const script = scriptResponse.text ?? ''

    // Step 2: Parse script into turns
    const turns = script
      .split('\n')
      .filter((line) => line.match(/^[AB]:/))
      .map((line) => ({
        speaker: line.startsWith('A:') ? 'A' : 'B',
        text:    line.replace(/^[AB]:\s*/, '').trim(),
      }))

    // Step 3: Generate multi-speaker audio with Gemini TTS
    const ttsContents = turns.map((turn) => ({
      role:  'user' as const,
      parts: [{ text: turn.text }],
    }))

    const ttsResponse = await gemini.models.generateContent({
      model:    'gemini-3.1-flash-lite-preview-preview-tts',
      contents: ttsContents,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              { speaker: 'A', voiceConfig: { prebuiltVoiceConfig: { voiceName: voice1 } } },
              { speaker: 'B', voiceConfig: { prebuiltVoiceConfig: { voiceName: voice2 } } },
            ],
          },
        },
      },
    })

    // Extract audio bytes from response
    const audioPart = ttsResponse.candidates?.[0]?.content?.parts?.find(
      (p: any) => p.inlineData?.mimeType?.startsWith('audio/')
    )

    if (!audioPart?.inlineData?.data) throw new Error('No audio returned from Gemini TTS')

    const audioBuffer = Buffer.from(audioPart.inlineData.data, 'base64')
    const storagePath = `podcasts/${noteId}/${Date.now()}.wav`
    const publicUrl   = await uploadAudio(storagePath, audioBuffer, 'audio/wav')

    // Step 4: Persist record
    const [record] = await db
      .insert(audioFiles)
      .values({ noteId, storageUrl: publicUrl, transcript: script })
      .returning()

    return { audioFileId: record.id, url: publicUrl }
  },
  { connection }
)
```

- [ ] **Step 5: Create the Narrator route**

```typescript
// apps/api/src/routes/agents/narrator.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { narratorQueue } from '../../lib/queues'
import { authMiddleware } from '../../middleware/auth'

const NarratorSchema = z.object({
  noteId: z.string().uuid(),
  voice1: z.string().optional(),
  voice2: z.string().optional(),
})

export const narratorRouter = new Hono()

narratorRouter.post(
  '/',
  authMiddleware,
  zValidator('json', NarratorSchema),
  async (c) => {
    const body = c.req.valid('json')
    const job  = await narratorQueue.add('run', body, { attempts: 2 })
    return c.json({ jobId: job.id, status: 'queued' }, 202)
  }
)
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/audio-files.ts \
        apps/api/src/jobs/narrator.job.ts \
        apps/api/src/routes/agents/narrator.ts \
        apps/api/src/lib/storage.ts \
        packages/db/drizzle/
git commit -m "feat(agent): narrator — Gemini MultiSpeaker TTS podcast generation with Supabase Storage"
```

---

### Task 6: Deep Research Agent (Gemini interactions API → polling → wiki integration)

**Files:**
- Create: `apps/api/src/routes/agents/deep-research.ts`
- Create: `apps/api/src/jobs/deep-research.job.ts`
- Create: `packages/db/src/schema/agent-results.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Add `agent_results` table**

```typescript
// packages/db/src/schema/agent-results.ts
import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { pgEnum } from 'drizzle-orm/pg-core'

export const agentStatusEnum = pgEnum('agent_status', [
  'pending', 'running', 'completed', 'failed'
])

export const agentResults = pgTable('agent_results', {
  id:           uuid('id').defaultRandom().primaryKey(),
  userId:       text('user_id').notNull(),
  agentType:    text('agent_type').notNull(),    -- 'deep-research' | 'synthesis' | etc.
  interactionId: text('interaction_id'),         -- Gemini interactions API ID
  status:       agentStatusEnum('status').default('pending').notNull(),
  payload:      jsonb('payload'),                -- structured result
  errorMessage: text('error_message'),
  noteId:       uuid('note_id'),                 -- if result was written to a note
  createdAt:    timestamp('created_at').defaultNow().notNull(),
  updatedAt:    timestamp('updated_at').defaultNow().notNull(),
})

export type AgentResult    = typeof agentResults.$inferSelect
export type NewAgentResult = typeof agentResults.$inferInsert
```

- [ ] **Step 2: Generate and run migration**

```bash
pnpm --filter @opencairn/db db:generate
pnpm --filter @opencairn/db db:migrate
```

- [ ] **Step 3: Create the Deep Research job**

The job calls `interactions.create()` with `background=true`, persists the `interactionId`, then polls every 10 seconds until the state is `completed` or `failed`. On completion it writes a new wiki note.

```typescript
// apps/api/src/jobs/deep-research.job.ts
import { Worker, Job } from 'bullmq'
import { db } from '../lib/db'
import { agentResults, notes, wikiLogs } from '@opencairn/db/schema'
import { eq } from 'drizzle-orm'
import { gemini } from '../lib/gemini'
import { connection } from '../lib/queues'

export interface DeepResearchJobData {
  prompt:    string
  projectId: string
  userId:    string
  resultId:  string   -- pre-created agentResults row ID
}

const POLL_INTERVAL_MS = 10_000
const MAX_POLLS        = 60    // 10 minutes max

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export const deepResearchWorker = new Worker<DeepResearchJobData>(
  'deep-research',
  async (job: Job<DeepResearchJobData>) => {
    const { prompt, projectId, userId, resultId } = job.data

    // 1. Start background deep-research interaction
    const interaction = await (gemini as any).interactions.create({
      model:  'gemini-deep-research-pro-preview',
      prompt,
      config: { background: true },
    })

    const interactionId: string = interaction.id ?? interaction.interactionId

    await db
      .update(agentResults)
      .set({ interactionId, status: 'running' })
      .where(eq(agentResults.id, resultId))

    // 2. Poll until complete
    let polls = 0
    let finalResult: any = null

    while (polls < MAX_POLLS) {
      await sleep(POLL_INTERVAL_MS)
      polls++

      const status = await (gemini as any).interactions.get({ interactionId })

      if (status.state === 'completed') {
        finalResult = status
        break
      }

      if (status.state === 'failed') {
        await db
          .update(agentResults)
          .set({ status: 'failed', errorMessage: status.error?.message ?? 'Unknown error' })
          .where(eq(agentResults.id, resultId))
        throw new Error(`Deep research failed: ${status.error?.message}`)
      }

      await job.updateProgress(Math.round((polls / MAX_POLLS) * 100))
    }

    if (!finalResult) throw new Error('Deep research timed out after 10 minutes')

    const reportText: string = finalResult.response?.text ?? JSON.stringify(finalResult)

    // 3. Write the research report as a new wiki note
    const [newNote] = await db
      .insert(notes)
      .values({
        projectId,
        title:   `Deep Research: ${prompt.slice(0, 80)}`,
        content: reportText,
      })
      .returning()

    // Log to wiki_logs
    await db.insert(wikiLogs).values({
      noteId:    newNote.id,
      userId,
      changeType: 'create',
      diff:       reportText.slice(0, 500),
    })

    await db
      .update(agentResults)
      .set({ status: 'completed', payload: { reportLength: reportText.length }, noteId: newNote.id })
      .where(eq(agentResults.id, resultId))

    return { noteId: newNote.id, reportLength: reportText.length }
  },
  { connection }
)
```

- [ ] **Step 4: Create the Deep Research route**

```typescript
// apps/api/src/routes/agents/deep-research.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../lib/db'
import { agentResults } from '@opencairn/db/schema'
import { eq } from 'drizzle-orm'
import { deepResearchQueue } from '../../lib/queues'
import { authMiddleware } from '../../middleware/auth'

const DeepResearchSchema = z.object({
  prompt:    z.string().min(10).max(2000),
  projectId: z.string().uuid(),
})

export const deepResearchRouter = new Hono()

// POST — start a deep research job
deepResearchRouter.post(
  '/',
  authMiddleware,
  zValidator('json', DeepResearchSchema),
  async (c) => {
    const { prompt, projectId } = c.req.valid('json')
    const userId = c.get('userId') as string

    // Pre-create the result row so the client has an ID to poll
    const [result] = await db
      .insert(agentResults)
      .values({ userId, agentType: 'deep-research', status: 'pending' })
      .returning()

    await deepResearchQueue.add(
      'run',
      { prompt, projectId, userId, resultId: result.id },
      { attempts: 1, jobId: result.id }
    )

    return c.json({ resultId: result.id, status: 'pending' }, 202)
  }
)

// GET — poll for job status and result
deepResearchRouter.get(
  '/:resultId',
  authMiddleware,
  async (c) => {
    const { resultId } = c.req.param()
    const [result] = await db
      .select()
      .from(agentResults)
      .where(eq(agentResults.id, resultId))

    if (!result) return c.json({ error: 'Not found' }, 404)
    return c.json(result)
  }
)
```

- [ ] **Step 5: Mount all agent routes in app.ts**

```typescript
// In apps/api/src/app.ts — add remaining agent routes:
import { temporalRouter }     from './routes/agents/temporal'
import { synthesisRouter }    from './routes/agents/synthesis'
import { curatorRouter }      from './routes/agents/curator'
import { narratorRouter }     from './routes/agents/narrator'
import { deepResearchRouter } from './routes/agents/deep-research'

// Inside the agents route group:
agents.route('/temporal',      temporalRouter)
agents.route('/synthesis',     synthesisRouter)
agents.route('/curator',       curatorRouter)
agents.route('/narrator',      narratorRouter)
agents.route('/deep-research', deepResearchRouter)
```

- [ ] **Step 6: Register all workers in the worker entry point**

```typescript
// apps/api/src/workers.ts  (create or update)
import './jobs/connector.job'
import './jobs/temporal.job'
import './jobs/synthesis.job'
import './jobs/curator.job'
import './jobs/narrator.job'
import './jobs/deep-research.job'

console.log('All agent workers started')
```

- [ ] **Step 7: Update queues.ts with all queue definitions**

```typescript
// apps/api/src/lib/queues.ts
import { Queue } from 'bullmq'
import Redis from 'ioredis'

export const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null })

export const connectorQueue    = new Queue('connector',     { connection })
export const temporalQueue     = new Queue('temporal',      { connection })
export const synthesisQueue    = new Queue('synthesis',     { connection })
export const curatorQueue      = new Queue('curator',       { connection })
export const narratorQueue     = new Queue('narrator',      { connection })
export const deepResearchQueue = new Queue('deep-research', { connection })
```

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/agent-results.ts \
        apps/api/src/jobs/deep-research.job.ts \
        apps/api/src/routes/agents/deep-research.ts \
        apps/api/src/routes/agents/temporal.ts \
        apps/api/src/routes/agents/synthesis.ts \
        apps/api/src/routes/agents/curator.ts \
        apps/api/src/routes/agents/narrator.ts \
        apps/api/src/lib/queues.ts \
        apps/api/src/workers.ts \
        apps/api/src/app.ts \
        packages/db/drizzle/
git commit -m "feat(agent): deep-research — Gemini interactions API with background polling + wiki integration; wire all agent routes"
```

---

### Env Vars to Add

~~Deprecated 기존 env~~ (BullMQ/Supabase 제거됨). 새 env는 Plan 3/4 공용 env 사용 + Plan 9 Gemini Deep Research toggle.

```bash
# 기존 공용 (이미 Plan 3/4에 정의)
LLM_PROVIDER=gemini                # gemini|openai|ollama
GEMINI_API_KEY=                    # BYOK Gemini 또는 Production 키
TEMPORAL_ADDRESS=localhost:7233
R2_ENDPOINT=                       # Cloudflare R2 (Narrator 오디오 저장)
R2_BUCKET=opencairn-uploads

# Plan 8 전용
GEMINI_DEEP_RESEARCH_ENABLED=true  # false면 Deep Research Agent는 웹검색+RAG fallback
```

---

## Task A1: 7개 에이전트 Python 재구현 (신규 표준)

> **Added 2026-04-14** — 아키텍처 재조정 후 표준 task. 위의 기존 Hono/TypeScript/BullMQ 섹션은 **deprecated**.

각 에이전트는 `apps/worker/src/worker/agents/<name>_agent.py`에 LangGraph StateGraph로 구현. Temporal workflow로 감싸서 `workflows/agent_workflows.py`에 정의. API 라우트는 Hono에서 Temporal client로 트리거.

**공통 파일 패턴:**
- `apps/worker/src/worker/agents/<name>_agent.py` — LangGraph state + nodes + `@activity.defn`
- `apps/worker/src/worker/workflows/<name>_workflow.py` — Temporal workflow 정의
- `apps/api/src/routes/agents/<name>.ts` — Hono 라우트 (Temporal trigger + polling)
- `packages/shared/src/api-types.ts` — Zod 입출력 스키마

### A1.1 Connector Agent

- [ ] **Step 1:** 프로젝트 간 약한 연결 제안. 입력: `concept_id`. 로직:
  1. 해당 concept의 임베딩 가져오기
  2. 다른 프로젝트 concepts에서 유사도 top-K (LightRAG vector search, threshold=0.75)
  3. 이미 엣지 있는 것 제외
  4. 결과를 `suggestions` 테이블에 저장 (사용자 승인/거절 대기)
- [ ] **Step 2:** API: `POST /api/agents/connector/run` (manual), Temporal cron (주 1회 전체 프로젝트)
- [ ] **Step 3:** 프론트엔드 알림 UI (Plan 5 KG-10)

### A1.2 Temporal Agent

- [ ] **Step 4:** 시간 기반 쿼리 + stale 지식 감지. 역할 3가지:
  1. **Timeline 뷰 빌드** — Plan 5 KG-07 요청을 Visualization Agent에 위임 받아 날짜 있는 concept 추출 + 정렬
  2. **Stale 감지** — 90일 이상 편집 안 된 wiki_pages에 LLM이 "최신 정보와 비교해서 여전히 유효?" 체크
  3. **복습 알림** — SM-2 간격 계산해서 Socratic Agent 트리거
- [ ] **Step 5:** Temporal cron (일 1회 stale 체크, 시간당 복습 알림)

### A1.3 Synthesis Agent

- [ ] **Step 6:** 여러 노드 선택 → 에세이 생성. 입력: `concept_ids[]`, `style` (essay | summary | comparison | slides). 로직:
  1. 각 concept의 wiki 본문 로드
  2. LightRAG로 추가 컨텍스트 (mode='global')
  3. `provider.generate()` + 긴 컨텍스트 (Gemini면 `cache_context()` 활용)
  4. 결과를 새 note로 저장 (사용자가 프로젝트에 추가할지 결정)
- [ ] **Step 7:** API: `POST /api/agents/synthesis/run`, 진행 상태 폴링

### A1.4 Curator Agent

- [ ] **Step 8:** 고아/모순/중복 감지 + 정리 제안. 역할:
  1. **고아 노드 감지** — degree 0 concepts 찾기
  2. **중복 감지** — 임베딩 유사도 > 0.9인 concept 쌍 → 병합 제안
  3. **모순 감지** — `provider.generate()`로 두 위키 본문 비교 ("이 둘 모순되나?")
  4. **주기 실행** — Temporal cron (일 1회)
  5. Gemini Search Grounding으로 외부 최신 정보와 사용자 지식 비교 (선택적)
- [ ] **Step 9:** `suggestions` 테이블에 저장, 프론트엔드 알림

### A1.5 Narrator Agent (팟캐스트 TTS)

- [ ] **Step 10:** 위키 또는 서브그래프 → 2인 대화 팟캐스트 오디오. 로직:
  1. 입력 concept/프로젝트의 본문 로드
  2. `provider.generate()`로 2인 대화 스크립트 생성 (시스템 프롬프트: "Host와 Guest의 자연스러운 대화")
  3. `provider.tts(script, model='gemini-2.5-pro-preview-tts', voices=['host_voice', 'guest_voice'])` — Gemini MultiSpeakerVoiceConfig
  4. 오디오 파일 R2 업로드, signed URL 반환
  5. Graceful degradation: provider가 TTS 미지원이면 스크립트만 반환, 프론트엔드는 텍스트로 표시
- [ ] **Step 11:** API: `POST /api/agents/narrator/run`, 백그라운드 (긴 작업)

### A1.6 Deep Research Agent

- [ ] **Step 12:** Gemini Deep Research API 활용 또는 fallback. 로직:
  1. Gemini provider + `GEMINI_DEEP_RESEARCH_ENABLED=true`면 Gemini Deep Research API 호출 (장시간 작업, 폴링)
  2. 아니면 fallback: `provider.ground_search()` (Gemini) 또는 web_search tool (crawl4ai + Research Agent)
  3. 결과를 새 source + wiki로 저장 (사용자 승인 후)
- [ ] **Step 13:** API: `POST /api/agents/deep-research/run`, Temporal workflow 긴 타임아웃 (2시간)

### A1.7 Visualization Agent

Plan 5 Task M1 참조. Plan 8에 중복 구현하지 않음 — Plan 5가 주 작업 문서.

### A1.8 통합 Commit

- [ ] **Step 14:** 에이전트별 개별 commit (`feat(agents): implement <name> agent`) 후 통합 PR.

---

## 구현 우선순위

Plan 4 → Plan 5 → **Plan 8 A1.1 ~ A1.6 순서 추천**:
1. **Synthesis** (가장 단순, 즉시 가치)
2. **Curator** (주기 실행, 품질 유지)
3. **Connector** (UX 개선)
4. **Temporal** (학습 시스템과 연동 필요, Plan 6 이후)
5. **Narrator** (TTS 의존성)
6. **Deep Research** (가장 복잡, Gemini 전용 기능 의존)
