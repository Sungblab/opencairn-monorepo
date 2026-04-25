# Plan 5 · Knowledge Graph Phase 1 — Project Graph Tab + Wiki-Link Backlinks

**Date:** 2026-04-25
**Status:** Draft (브레인스토밍 합의 완료, 구현 plan 작성 대기)
**Replaces / refines:** `docs/superpowers/plans/2026-04-09-plan-5-knowledge-graph.md` (Tasks 1–10 의 web 측 + LightRAG 가정 폐기, M1 Visualization Agent 는 Phase 2 로 이연)

**Related:**
- [App Shell Redesign Design](2026-04-23-app-shell-redesign-design.md) §탭 시스템 / §모드 라우터 / §사이드바
- [Plan 7 · Canvas Phase 1](2026-04-25-plan-7-canvas-phase-1-design.md) — 동일한 "Tab Mode Router 신규 모드 + DB 영속화 + i18n parity + 회귀 가드" 패턴의 선례
- [Agent Runtime v2 — Umbrella](2026-04-22-agent-runtime-v2-umbrella.md) §Sub-B (Compiler/Research retrofit) — Visualization Agent 도입 전 선행
- [ADR-007 — Embedding switch](../../architecture/adr/007-embedding-switch.md) — 768d MRL, 본 spec 의 KG 추출은 손대지 않으므로 직접 영향 없음
- `docs/architecture/api-contract.md` — 본 PR 에서 graph / backlinks 라우트 추가
- `docs/superpowers/specs/2026-04-21-plan-11b-chat-editor-knowledge-loop-design.md` — backlinks 와 provenance 의 책임 경계 (§1.4)

---

## 0. 요약 한 단락

OpenCairn 은 이미 ingest → Compiler 에이전트가 `concepts` / `concept_edges` 테이블을 채우고 있다. 그러나 사용자에게는 **그 그래프를 볼 표면이 없다**. 이 spec 은 (1) App Shell Tab Mode Router 의 신규 `graph` 모드 + Cytoscape 기반 force-directed 단일 뷰, (2) 노트 우측의 wiki-link **Backlinks Panel** + 인덱스 테이블, (3) 사이드바 진입점 한 개를 추가한다. KG 추출 파이프라인은 손대지 않는다. 본 Phase 는 *시각화 표면* 만 깔고, 5뷰 / Visualization Agent / 클러스터링 / 이해도 색상은 모두 Phase 2 이후로 이연한다.

---

## 1. Goal & Scope

### 1.1 In-scope

1. Tab Mode Router 신규 `graph` 모드 + `<ProjectGraphViewer projectId>` 어댑터 (탭 `kind='project'`, `mode='graph'`, `targetId=projectId`)
2. `cytoscape.js` + `react-cytoscapejs` + `cytoscape-fcose` (force-directed) 풀-프로젝트 그래프 — 검색 박스 · 관계 타입 (`relationType`) 필터 · 노드 단일 클릭 = 선택 highlight · 노드 더블 클릭 = 해당 concept 의 첫 source 노트로 preview 탭 push · 노드 드래그 / 휠 줌
3. 노드 캡 **500개** (degree 내림차순), 초과 시 배너 + 검색·관계 필터로 강제 narrowing. **N-hop 확장 API** (특정 concept 클릭 → 1-hop 이웃만 fetch 후 머지)
4. **Backlinks Panel** — `mode='plate'` 노트 탭의 우측 collapsible 사이드 패널 (`⌘⇧B` 토글). 데이터 source = `GET /api/notes/:id/backlinks` (current note 를 wiki-link 로 가리키는 다른 노트들)
5. 신규 `wiki_links` 인덱스 테이블 (sourceNoteId / targetNoteId / workspaceId, unique pair). **Hocuspocus `persistence.store` 트랜잭션 안에서 inline 동기화** (Plate value 가 권위인 시점). 마이그레이션에 backfill SQL 포함
6. API 라우트 (모두 user-session, `requireAuth` + `canRead/canWrite` chain, workspace 격리):
   - `GET /api/projects/:projectId/graph?limit=500&order=degree` — 풀 그래프 (top-N by degree)
   - `GET /api/projects/:projectId/graph/expand/:conceptId?hops=1` — N-hop 확장
   - `GET /api/notes/:id/backlinks` — wiki-link 역참조
7. 사이드바 진입점 — 프로젝트 트리 위, `ScopedSearch` 형제 위치에 신규 `<ProjectGraphLink />` 버튼 ("이 프로젝트 그래프 보기"). 클릭 → 새 탭 `(kind='project', mode='graph')` push, URL `/w/<slug>/p/<projectId>/graph`
8. `messages/{ko,en}/graph.json` 신규 (parity, Plan 9a CI gate 통과)
9. Vitest 단위 / 컴포넌트 + API 테스트 + Playwright E2E 1 spec
10. 회귀 CI 가드 (cytoscape latest 태그 금지 / postMessage `*` 등 — Plan 7 패턴 답습)

### 1.2 Out-of-scope (Phase 2+)

- **Visualization Agent** (`runtime.Agent` v2) — Agent Runtime v2 Sub-B (Compiler/Research/Librarian retrofit) 머지 후 도입. ViewSpec 스키마 / `build_mindmap` / `build_timeline` 모두 이연
- **추가 4뷰** (Mindmap tree / Cards / Timeline / "5뷰의 Canvas"). 5뷰의 Canvas 는 Plan 7 Canvas (코드 실행) 와 명칭 충돌 → Phase 2 시작 시 재명명 결정
- **클러스터링 오버레이** (Louvain) / **이해도 점수 기반 노드 색상** — 시각화 Phase 2
- **크로스-프로젝트 그래프** — 워크스페이스 단위 통합 KG 는 별도 spec
- **KG 편집 UI** — concept rename / merge / split / 수동 edge 추가. 본 Phase 는 **read-only 시각화** + 노트로 점프만
- **Yjs 협업** — 그래프는 read-mostly 단일 사용자 모델. presence 표기 없음
- **inline graph Plate block** — Plan 10B 영역
- **그래프 공유 링크 / 임베드** — 별도 follow-up
- **Tab Mode Router 자동 매핑** — 노트 열 때 `mode='graph'` 자동 설정 안 함. 그래프 탭은 항상 사이드바 진입점 또는 직접 URL 로만 열림 (Plan 7 의 `sourceType='canvas'` → `mode='canvas'` auto-detect 와 다름 — 그래프는 노트가 아님)

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  App Shell (이미 머지됨)                                          │
│   Sidebar          Tab Mode Router                  Agent Panel  │
│   ────────         ─────────────────                ───────────  │
│   ProjectHero      tab.mode === 'graph' ?                        │
│   ScopedSearch     → <ProjectGraphViewer                         │
│   [그래프 보기]🆕     projectId={tab.targetId} />                │
│   ProjectTree                                                    │
└──────────────────────────────────────────────────────────────────┘
              │                            │
              │ user click                 │ tab activated
              ▼                            ▼
       new Tab push                  ┌───────────────────────┐
       (kind='project',              │ ProjectGraphViewer    │
        mode='graph')                │  ├─ <GraphFilters>    │
                                     │  ├─ <Cytoscape fcose> │
                                     │  └─ <NodeContextMenu> │
                                     └─────┬─────────────────┘
                                           │ fetch
                                           ▼
                          ┌────────────────────────────────────┐
                          │ GET /api/projects/:id/graph        │
                          │ GET /api/projects/:id/graph/expand │
                          │ (apps/api Hono routes — workspace  │
                          │  scope + canRead via chain)        │
                          └─────┬──────────────────────────────┘
                                │
                                ▼
                   ┌───────────────────────────┐
                   │ Postgres (이미 채워져 있음) │
                   │   concepts (name, embed)  │
                   │   concept_edges (rel/wt)  │
                   │   concept_notes (join)    │
                   └───────────────────────────┘

  ── 별개의 경로: Backlinks ────────────────────────────────────────
  
  Plate 에디터 우측 collapsible 패널 ──► GET /api/notes/:id/backlinks
                                              │
                                              ▼
                                  SELECT FROM wiki_links 🆕
                                  WHERE target_note_id = :id
                                    AND target.deleted_at IS NULL
                                    AND canRead(user, source_note_id)

  Hocuspocus persistence.store(noteId, state):
    1. Y.Doc → plateValue
    2. UPDATE notes SET content, content_text       (기존)
    3. syncWikiLinks(tx, noteId, plateValue) 🆕     (이 PR)
        - extract wiki-link node targetIds (deep)
        - DELETE wiki_links WHERE source = noteId
        - INSERT wiki_links (source, target, ws)
```

### 2.1 컴포넌트 경계

1. **`apps/web/src/components/graph/`** — pure presentational + Cytoscape 래퍼. `noteId`/`projectId` 인지하지만 라우팅 모름.
2. **`apps/web/src/components/tab-shell/viewers/project-graph-viewer.tsx`** — Tab Mode Router 어댑터. `tab.targetId` → `<ProjectGraph projectId>` 마운트 + 노드 클릭 시 `tabsStore.addTab` 호출.
3. **`apps/web/src/components/notes/BacklinksPanel.tsx`** — note plate 탭 우측 패널. plate viewer 가 컴포지션.
4. **`apps/web/src/components/sidebar/project-graph-link.tsx`** — `ScopedSearch` 형제, 새 탭 push 만 담당.
5. **`apps/api/src/routes/graph.ts`** — neue Hono 라우터, 권한 체인 + Drizzle 쿼리.
6. **`apps/api/src/routes/notes.ts`** — `/:id/backlinks` 서브 라우트만 추가. PATCH 핸들러 변경 없음 (content 안 받음).
7. **`apps/hocuspocus/src/wiki-link-sync.ts`** 🆕 — `extractWikiLinkTargets(plateValue)` + `syncWikiLinks(tx, noteId, targets, workspaceId)` helper. `persistence.ts` 가 import.
8. **`packages/db/`** — `wiki_links` schema + migration 만. 비즈 로직 없음.

### 2.2 불변식

- `wiki_links.source_note_id` 와 `wiki_links.target_note_id` 모두 `notes(id) ON DELETE CASCADE`
- `wiki_links` 의 `(source_note_id, target_note_id)` 는 unique — 같은 노트가 동일 타깃을 N번 wiki-link 해도 backlinks 카운트는 1
- `wiki_links.workspace_id` 는 source 의 workspace 와 동일 (target 의 workspace 와 다를 수 있음 — 워크스페이스 격리 보장은 API 권한 chain 에서)
- 그래프 응답 노드 수 ≤ `MAX_GRAPH_NODES = 500` (서버 + 클라이언트 이중 가드)
- `expand` 의 `hops` ≤ 3 (서버 가드 — 재귀 CTE 폭발 방지)
- Cytoscape 라이브러리 버전 floating 금지: `cytoscape@^3.30`, `cytoscape-fcose@^2.2`, `react-cytoscapejs@^2.0` (PYODIDE_VERSION 패턴 답습)
- 그래프 / backlinks 응답은 모두 `canRead` 통과한 노드 / 노트만 포함 — 권한 누수 0

### 2.3 의도적 단순화

- **그래프 데이터 캐싱**: TanStack Query `staleTime: 30s`. Concept 추출은 ingest 후 비동기 (수십 초 단위), 사용자가 그래프 탭 다시 열어도 신선함 충분
- **레이아웃 결정성**: fcose 는 비결정적이지만 `randomize: false` + node `position` 캐시는 안 함. 매번 fresh layout — 사용자가 노드 드래그 시점만 사용자 위치 보존 (Cytoscape 기본 동작)
- **선택 상태 영속화 X**: 탭 닫았다 다시 열면 선택 / 줌 / pan 초기화 (Plate 의 scrollY 만 보존하는 정책과 동일)

---

## 3. DB Schema & Migration

### 3.1 신규 테이블 `packages/db/src/schema/wiki-links.ts`

```ts
import {
  pgTable,
  uuid,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { workspaces } from "./workspaces";

// Plan 5 Phase 1. Reverse index of wiki-link Plate nodes (`type: 'wiki-link'`,
// `targetId: uuid`). Populated inline by Hocuspocus persistence.store on every
// flush; backfilled once via migration. workspace_id mirrors source.workspace
// so backlinks queries can be workspace-scoped without a join through projects.
//
// Source/target both ON DELETE CASCADE — if either note is HARD-deleted
// (`DELETE FROM notes`), the row goes with it. Soft-deletes (`notes.deleted_at`)
// are filtered in API queries, not by the FK.
export const wikiLinks = pgTable(
  "wiki_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceNoteId: uuid("source_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    targetNoteId: uuid("target_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("wiki_links_source_target_unique").on(t.sourceNoteId, t.targetNoteId),
    index("wiki_links_target_idx").on(t.targetNoteId),
    index("wiki_links_workspace_idx").on(t.workspaceId),
  ]
);
```

### 3.2 Migration `packages/db/drizzle/0020_wiki_links_table.sql`

> 번호 race: Plan 7 Canvas Phase 1 도 0020/0021 차지. 늦게 머지되는 쪽이 다음 번호 + Drizzle journal 갱신. 충돌 패턴은 파일명 + `meta/_journal.json` 두 곳.

```sql
-- Plan 5 Phase 1: wiki-link reverse index.
CREATE TABLE "wiki_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_note_id" uuid NOT NULL REFERENCES "notes"("id") ON DELETE CASCADE,
  "target_note_id" uuid NOT NULL REFERENCES "notes"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "wiki_links_source_target_unique"
    UNIQUE ("source_note_id", "target_note_id")
);

CREATE INDEX "wiki_links_target_idx" ON "wiki_links" ("target_note_id");
CREATE INDEX "wiki_links_workspace_idx" ON "wiki_links" ("workspace_id");

-- Backfill from existing notes.content. Plate node shape:
--   { type: 'wiki-link', targetId: '<uuid>', title: '<str>', children: [...] }
-- jsonb_path_query (PG 12+) recursively descends; '$.** ? (@.type == "wiki-link")'
-- yields every wiki-link node at any depth. We then validate targetId is a UUID
-- string AND points to a still-existing note row before insert.
INSERT INTO "wiki_links" ("source_note_id", "target_note_id", "workspace_id")
SELECT DISTINCT
  n.id AS source_note_id,
  (link->>'targetId')::uuid AS target_note_id,
  p.workspace_id
FROM "notes" n
JOIN "projects" p ON p.id = n.project_id
JOIN LATERAL jsonb_path_query(n.content, '$.** ? (@.type == "wiki-link")') AS link
  ON true
WHERE n.deleted_at IS NULL
  AND n.content IS NOT NULL
  AND link ? 'targetId'
  AND (link->>'targetId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM "notes" t
    WHERE t.id = (link->>'targetId')::uuid
      AND t.deleted_at IS NULL
  )
ON CONFLICT ("source_note_id", "target_note_id") DO NOTHING;
```

**메모:**
- backfill 은 한 번만 실행, 본 마이그레이션 적용 시점 이후 wiki-link 변경은 §4 의 inline sync 가 담당
- 자기 자신을 가리키는 wiki-link (`source = target`) 는 백필이 그대로 INSERT — API 응답에서 필터링 (§5.3)
- `notes.content` 가 NULL 인 옛 노트 (Plate value 시드 전) 는 자동 skip
- backfill 시간: 노트 수 N 의 O(N) 단일 패스. 50K 노트 / 평균 5 wiki-link 가정 dev 환경 < 30s. 운영 마이그레이션 시점 monitoring 권장 (운영 데이터 규모는 현재 < 1K 노트라 영향 0)

### 3.3 Rollback

```sql
DROP TABLE "wiki_links";
```

`concepts` / `concept_edges` 는 본 spec 영역 밖 — 손대지 않는다.

---

## 4. Wiki-Link Sync (Hocuspocus 통합)

### 4.1 책임 경계

`apps/hocuspocus/src/persistence.ts` 의 `store(documentName, state)` 는 이미 Y.Doc → plateValue 변환 + `notes.content` UPDATE 를 단일 transaction 으로 수행한다. wiki-link 동기화는 **이 transaction 안에 inline 추가**. 별도 worker / 외부 hook 없음.

이유:
- atomicity — `notes.content` 와 `wiki_links` 가 영원히 어긋나지 않음
- locality — wiki-link 는 plateValue 의 *그 시점* 스냅샷 — 이미 메모리에 있음
- Hocuspocus 는 본래 노트 메타 mirror 책임을 가지고 있음 (`contentText` extract 와 동일 패턴)

### 4.2 신규 `apps/hocuspocus/src/wiki-link-sync.ts`

```ts
import type { PgTransaction } from "drizzle-orm/pg-core";
import { wikiLinks, notes, eq, and, inArray, isNull } from "@opencairn/db";

// `i` flag: external systems (some Better Auth flows, ingest sources) can
// emit upper- or mixed-case UUIDs. Plate is consistent today but we don't
// own the producers transitively — be permissive on read.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Walk a Plate value (deeply nested array of nodes with `children`) and
 * collect unique wiki-link `targetId`s. Returns a Set so callers don't
 * insert duplicates.
 */
export function extractWikiLinkTargets(plateValue: unknown): Set<string> {
  const out = new Set<string>();
  const stack: unknown[] = Array.isArray(plateValue) ? [...plateValue] : [];
  while (stack.length) {
    const n = stack.pop();
    if (n && typeof n === "object") {
      const node = n as { type?: string; targetId?: unknown; children?: unknown };
      if (node.type === "wiki-link" && typeof node.targetId === "string" && UUID_RE.test(node.targetId)) {
        out.add(node.targetId);
      }
      if (Array.isArray(node.children)) stack.push(...node.children);
    }
  }
  return out;
}

/**
 * Replace the wiki_links rows for `sourceNoteId` with the deduped target set.
 * Runs inside the transaction passed by persistence.store, so the new index
 * is committed atomically with notes.content.
 *
 * Targets pointing to non-existent / soft-deleted notes are silently dropped
 * — matches the backfill semantic.
 */
export async function syncWikiLinks(
  tx: PgTransaction<any, any, any>,
  sourceNoteId: string,
  targets: Set<string>,
  workspaceId: string
): Promise<void> {
  // 1) drop existing rows for this source — full rebuild semantic
  await tx.delete(wikiLinks).where(eq(wikiLinks.sourceNoteId, sourceNoteId));

  if (targets.size === 0) return;

  // 2) filter targets to existing, non-deleted notes (single SELECT)
  const targetIds = [...targets].filter((id) => id !== sourceNoteId);
  if (targetIds.length === 0) return;

  const live = await tx
    .select({ id: notes.id })
    .from(notes)
    .where(and(inArray(notes.id, targetIds), isNull(notes.deletedAt)));
  const liveSet = new Set(live.map((r) => r.id));
  const rows = targetIds
    .filter((t) => liveSet.has(t))
    .map((targetNoteId) => ({
      sourceNoteId,
      targetNoteId,
      workspaceId,
    }));
  if (rows.length === 0) return;

  // .onConflictDoNothing() guards against the rare case where two Hocuspocus
  // store transactions for the same note interleave — the DELETE→SELECT→INSERT
  // sequence is atomic *per* tx, but PostgreSQL's READ COMMITTED default lets
  // a peer tx commit between the DELETE and INSERT and reach the unique
  // constraint first. Cheaper than escalating isolation; the constraint
  // itself still enforces correctness.
  await tx.insert(wikiLinks).values(rows).onConflictDoNothing();
}
```

### 4.3 `persistence.ts` 패치

`apps/hocuspocus/src/persistence.ts` 의 store 트랜잭션 (line 198~226). store 함수 자체는 fetch 와 분리된 핸들러라 `workspaceId` 를 캐시해 두지 않는다 — 트랜잭션 안에서 `resolveWorkspaceForNote` 로 한 번 SELECT 한다 (`projects.workspaceId` 는 노트 이동으로 변경 불가, 안전):

```diff
+import {
+  extractWikiLinkTargets,
+  resolveWorkspaceForNote,
+  syncWikiLinks,
+} from "./wiki-link-sync.js";
...
   await db.transaction(async (tx) => {
     await tx
       .insert(yjsDocuments)
       .values({...})
       .onConflictDoUpdate({...});
     await tx
       .update(notes)
       .set({
         content: plateValue as unknown,
         contentText,
         updatedAt: new Date(),
       })
       .where(eq(notes.id, noteId));
+    // Plan 5 Phase 1: rebuild wiki_links index from the just-saved Plate value.
+    // Resolve workspaceId from the source note inside the same tx — if the
+    // note was hard-deleted between fetch and store, resolve returns null
+    // and we skip the sync (the UPDATE notes above is also a no-op then).
+    const workspaceId = await resolveWorkspaceForNote(tx, noteId);
+    if (workspaceId) {
+      const targets = extractWikiLinkTargets(plateValue);
+      await syncWikiLinks(tx, noteId, targets, workspaceId);
+    }
   });
```

**테스트 hooks:**
- `extractWikiLinkTargets` 는 pure function — 별도 unit test (deep nesting / 잘못된 type / 자기참조 / 중복 / 비-UUID)
- `syncWikiLinks` 는 통합 테스트 — fixture note 에 wiki-link 추가 → store 호출 후 wiki_links 행 검증

### 4.4 실패 모드

| 상황 | 동작 |
|---|---|
| target note 가 존재하지 않음 (UUID 형식이지만 DB 에 없음) | 조용히 skip. 사용자에게 알림 없음 — Plate UI 가 이미 "deleted" 상태로 렌더 |
| target note 가 다른 워크스페이스 노트 | 현재 모델상 Plan 2A wiki-link 검색 자체가 워크스페이스 내부로 한정 → 정상 경로에서는 발생 안 함. 만약 누가 우회로 inject 하면 backlinks 응답 권한 필터에서 차단 |
| 자기 자신 wiki-link | extract 단계에서 `id !== sourceNoteId` 필터로 제외 |
| Hocuspocus store 실패 | 기존 트랜잭션과 함께 롤백 — 부분 갱신 없음 |

---

## 5. API Contract

`/api/projects/:projectId/graph*` 와 `/api/notes/:id/backlinks` 모두 user-session 기반 public API (internal-only 아님). 권한 모델은 기존 `notes.ts` / `mentions.ts` 의 `requireAuth + canRead` 체인 그대로.

### 5.1 GET `/api/projects/:projectId/graph` — 신규

**쿼리 파라미터:**

```ts
const graphQuerySchema = z.object({
  limit: z.coerce.number().int().min(50).max(500).default(500),
  order: z.enum(["degree", "recent"]).default("degree"),
  relation: z.string().optional(), // concept_edges.relation_type 필터
});
```

**Handler 의무:**
1. `requireAuth`
2. `canRead(user.id, { type: "project", id: projectId })` — 403 시 거부
3. concepts 의 top-N 선택:
   - `order=degree`: `JOIN` 또는 서브쿼리로 `count(concept_edges)` desc
   - `order=recent`: `concepts.created_at` desc
4. 그 N 개의 ID 사이 edges 만 반환 (boundary edges 도 포함하면 dangling node 발생)
5. response body:

```ts
{
  nodes: Array<{
    id: string;                   // concept.id
    name: string;
    description: string;          // 본 Phase 는 description (요약 별도 컬럼 없음)
    degree: number;               // 연결된 edges 수 (UI 노드 크기 매핑)
    noteCount: number;            // concept_notes 카운트 (UI 색상/배지)
    firstNoteId: string | null;   // 노드 더블클릭 시 점프 대상.
                                  // LEFT JOIN concept_notes ORDER BY notes.created_at LIMIT 1.
                                  // 추가 fetch 없이 클릭 jump 가능. null = 아직 노트 없음.
  }>,
  edges: Array<{
    id: string;            // concept_edge.id
    sourceId: string;
    targetId: string;
    relationType: string;  // 'is-a' | 'uses' | ... | 자유 텍스트
    weight: number;
  }>,
  truncated: boolean;      // 실제 concept 수 > limit 인 경우 true
  totalConcepts: number;   // 디버그/UI 배너용
}
```

**Edge cases:**
- 빈 프로젝트 → `{ nodes: [], edges: [], truncated: false, totalConcepts: 0 }`
- limit 초과 → `truncated: true`, UI 가 검색·필터로 narrowing 유도

### 5.2 GET `/api/projects/:projectId/graph/expand/:conceptId` — 신규

특정 concept 의 N-hop 이웃만 반환. UI 의 "이 노드 주변 펼치기" / 노드 더블클릭 동작.

**쿼리:**

```ts
const expandQuerySchema = z.object({
  hops: z.coerce.number().int().min(1).max(3).default(1),
});
```

**Handler:**
1. `requireAuth` + `canRead(project)`
2. `concepts.id = conceptId AND concepts.project_id = projectId` 검증 (projectId path 와 conceptId 의 cross-project 시도 차단)
3. 재귀 CTE 로 N-hop 도달 가능 concept ids 수집
4. 노드 + 그 사이 edges 반환 (5.1 와 동일 shape, `truncated`/`totalConcepts` 생략)

**가드:**
- `hops ≤ 3` (서버 enum 제한)
- 결과 노드 수 hard cap 200 — 초과 시 truncate + 응답 헤더 `X-Truncated: true`
- `conceptId` 가 다른 project 소속이면 404 (resource scope leak 방지)

### 5.3 GET `/api/notes/:id/backlinks` — 신규 (`apps/api/src/routes/notes.ts` 서브 라우트)

**Handler:**
1. `requireAuth`
2. `canRead(user.id, { type: "note", id })` — 거부 시 403
3. `wiki_links.target_note_id = id` JOIN `notes` (source 측, deletedAt IS NULL)
4. **각 source 노트에 per-row `canRead` 적용** — `mentions.ts` 의 over-fetch + filter 패턴 답습 (private 노트가 검색에서 새지 않도록)
5. 응답:

```ts
{
  data: Array<{
    id: string;          // source note id
    title: string;
    projectId: string;
    projectName: string;
    updatedAt: string;
  }>,
  total: number;         // 권한 필터 *후* 의 카운트 (헤더 배지용)
}
```

**Edge cases:**
- backlinks 0 → `{ data: [], total: 0 }`
- 자기 자신 wiki-link → §4.2 에서 이미 거름. 여기서는 추가로 filter 안 함
- soft-deleted source 노트 → 자동 제외 (WHERE deletedAt IS NULL)
- target 노트가 hard-deleted → 라우트가 404 직전 단계에서 노트 자체가 없음. canRead 에서 false 반환 → 403 자연스럽게 거부

### 5.4 i18n 에러 메시지

API 는 코드만 (`{ error: 'forbidden' }`, `{ error: 'not-found' }`, `{ error: 'too-many-hops' }`). 사용자 노출 문구는 `messages/{ko,en}/graph.json` 의 `errors.*` lookup.

### 5.5 internal API 가 아님 (workspace scope memo 비대상)

`feedback_internal_api_workspace_scope` 메모리는 `/api/internal/*` 쓰기 라우트에 한정. 본 PR 의 라우트는 모두 user-session GET 이며 `canRead` chain 으로 workspace 격리 강제. 추가 workspace_id 파라미터 없음.

---

## 6. Web 컴포넌트, Tab Mode Router 통합, Cytoscape

### 6.1 파일 구조

```
apps/web/src/
├── components/
│   ├── graph/                                  # NEW (도메인, 라우팅 모름)
│   │   ├── ProjectGraph.tsx                    # Cytoscape 래퍼 + 데이터 fetch
│   │   ├── GraphFilters.tsx                    # 검색박스 + relation 셀렉트 + 노드 캡 배너
│   │   ├── GraphNodeContextMenu.tsx            # 노드 우클릭 — Phase 1 은 "노트로 이동"만
│   │   ├── GraphEmpty.tsx                      # 빈 상태 (concepts 0)
│   │   ├── useProjectGraph.ts                  # TanStack Query — full + expand
│   │   ├── graph-types.ts                      # GraphNode/GraphEdge UI 타입
│   │   └── __tests__/
│   │       ├── ProjectGraph.test.tsx
│   │       ├── GraphFilters.test.tsx
│   │       └── useProjectGraph.test.ts
│   ├── tab-shell/
│   │   ├── tab-mode-router.tsx                 # MOD: case 'graph'
│   │   ├── tab-mode-router.test.tsx            # MOD
│   │   └── viewers/
│   │       ├── project-graph-viewer.tsx        # NEW (Tab → ProjectGraph 어댑터)
│   │       └── project-graph-viewer.test.tsx   # NEW
│   ├── notes/
│   │   ├── BacklinksPanel.tsx                  # NEW (Plate 탭 우측 패널)
│   │   └── __tests__/BacklinksPanel.test.tsx   # NEW
│   └── sidebar/
│       ├── project-graph-link.tsx              # NEW (사이드바 진입점)
│       └── project-graph-link.test.tsx         # NEW
├── stores/
│   └── tabs-store.ts                           # MOD: 'graph' mode union
├── messages/{ko,en}/
│   └── graph.json                              # NEW
├── app/[locale]/(shell)/w/[wsSlug]/p/[projectId]/graph/
│   └── page.tsx                                # NEW (URL → tab 매핑 entry)
└── tests/e2e/
    └── graph.spec.ts                           # NEW
```

### 6.2 `tabs-store.ts` 변경

```diff
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
+  | "graph"
   | "mindmap"
   | "flashcard";
```

> 충돌 회피: Plan 7 Canvas Phase 1 은 `'canvas'` 추가. 본 PR 은 알파벳 정렬 위치에 `'graph'` 삽입. union 머지 시 정렬 유지하면 자동 머지 (수동 conflict 가능성 낮음).

### 6.3 `tab-mode-router.tsx` 변경

```diff
   case "data":
     return <DataViewer tab={tab} />;
+  case "graph":
+    return <ProjectGraphViewer tab={tab} />;
+  // (Phase 2) case "mindmap": tree-layout 변형
   default:
     return <StubViewer mode={tab.mode} />;
```

`isRoutedByTabModeRouter` predicate (Phase 3-B 도입) 에 `'graph'` 추가. `Tab.titleKey` 기본 = `appShell.tabTitles.graph` (= "그래프 / Graph"), targetId 가 있으면 fallback 으로 project name 사용.

### 6.4 `ProjectGraphViewer` (Tab Mode Router 어댑터)

```tsx
"use client";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";
import { ProjectGraph } from "@/components/graph/ProjectGraph";

export function ProjectGraphViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("graph.viewer");
  if (!tab.targetId) {
    return <div className="p-6 text-sm text-muted-foreground">{t("missing")}</div>;
  }
  return <ProjectGraph projectId={tab.targetId} />;
}
```

저장할 상태 없음 — pure 표시. tab.scrollY 도 무의미 (Cytoscape 가 자체 viewport 관리).

### 6.5 `ProjectGraph` (Cytoscape 래퍼)

```
┌──────────────────────────────────────────────────────────┐
│ [🔍 검색…]  관계: ▼ All  · 표시 320/847 (top by degree) │   ← <GraphFilters>
├──────────────────────────────────────────────────────────┤
│                                                          │
│             ●─────●     ●         ●                      │
│           /  \   /     / \      /                        │
│          ●    ●─●     ●   ●────●                         │
│           \  /                                           │
│            ●                                             │
│                                                          │
│   [+] zoom in  [−] zoom out  [⤿] reset                  │
└──────────────────────────────────────────────────────────┘
```

핵심 props / 구현:

```tsx
"use client";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { useMemo } from "react";
import { useProjectGraph } from "./useProjectGraph";

cytoscape.use(fcose);

export function ProjectGraph({ projectId }: { projectId: string }) {
  const { data, isLoading, error, expand } = useProjectGraph(projectId);
  const elements = useMemo(() => toCytoscapeElements(data), [data]);

  if (isLoading) return <GraphSkeleton />;
  if (error) return <GraphError error={error} />;
  if (!data || data.nodes.length === 0) return <GraphEmpty />;

  return (
    <div className="flex h-full flex-col">
      <GraphFilters truncated={data.truncated} totalConcepts={data.totalConcepts} />
      <CytoscapeComponent
        elements={elements}
        layout={{ name: "fcose", animate: true, randomize: false, padding: 30 }}
        stylesheet={GRAPH_STYLESHEET}
        cy={(cy) => bindGraphInteractions(cy, { onNodeClick, onNodeExpand: expand })}
        style={{ width: "100%", flex: 1 }}
      />
    </div>
  );
}
```

**노드 인터랙션:**
- 단일 클릭 → 선택 highlight + Cytoscape `selectionDelayed` debounce
- 더블 클릭 → `onNodeClick(conceptId)` — concept 의 첫 source 노트로 새 탭 push (`tabsStore.addOrReplacePreview`, preview tab 으로 — Plan App Shell §5.4)
- `Alt+클릭` 또는 우클릭 → `<GraphNodeContextMenu>` (Phase 1: "이 노트 열기", "주변 펼치기" 두 항목만)
- 호버 → tooltip: name + description (truncate 200 char)

**`bindGraphInteractions`** 가 cy 인스턴스에 `tap` / `cxttap` / `hover` 핸들러 부착. side-effect 가 useEffect 가 아닌 mount 시 1회 — Cytoscape 의 idiom 따름.

**노드 → 노트 매핑**: §5.1 의 GraphDto 응답에서 각 node 가 `firstNoteId: string | null` 을 들고 옴 (LEFT JOIN concept_notes ORDER BY notes.created_at LIMIT 1). 더블클릭 시 추가 round-trip 없이 즉시 `tabsStore.addOrReplacePreview({ kind: 'note', mode: 'plate', targetId: firstNoteId })`. `firstNoteId === null` (concept 만 있고 source 노트 미등록) 인 노드는 더블클릭 시 toast 로 알림 ("이 개념에 연결된 노트가 없습니다").

### 6.6 `BacklinksPanel`

```
┌──────────────────────────────────────────────────┐
│ [📄 Attention is All You Need]    💬 3  🔗 12   │
├──────────────────────────────────────────────────┤
│ Plate 에디터 ────────────────────────  Backlinks │
│                                          (12)    │
│                                          ────    │
│                                       ► Self-Att │
│                                         (Notes)  │
│                                       ► BERT 비교│
│                                         (Notes)  │
│                                       …          │
│                                                  │
└──────────────────────────────────────────────────┘
```

- 노트 plate 탭에서만 렌더 (`tab.kind === 'note'` && `tab.mode === 'plate'`)
- `⌘⇧B` 키바인딩으로 collapse / expand. 상태는 `panel-store.ts` 에 추가 (`backlinksOpen: boolean`, user-global localStorage)
- 데이터 fetch: TanStack Query, key `['backlinks', noteId]`, `staleTime: 30s`
- 빈 상태 (`total === 0`): 패널 상단에 "백링크 없음" 텍스트 + ScopedSearch 같은 hint
- 각 row 클릭 → preview tab 으로 source 노트 열기 (`addOrReplacePreview`)
- 헤더 배지 `🔗 N` 은 plate-toolbar 의 기존 `[💬 N]` 옆에 — Plan 11B §5.2 의 metadata strip 에 한 칸 추가

**Plan 11B 와의 책임 경계:**

| 항목 | 정의 | 출처 | 본 PR 책임? |
|---|---|---|---|
| `[💬 N] 코멘트` | 노트 본문 코멘트 카운트 | Plan 2B `comments` 테이블 | 아니오 (이미 머지됨) |
| `[🔗 N] backlinks` | 이 노트를 wiki-link 로 가리키는 다른 노트 수 | 본 PR `wiki_links` | **예** |
| `[📚 N] 관련 페이지` (related_pages) | semantic 유사도 — chat 답변 시 fetch | Plan 11B §7 | 아니오 (Phase D 영역) |
| `Provenance (이 페이지의 유래 대화)` | concept 단위 chat 메시지 추적 | Plan 11B §5 (`concept_source_links`) | 아니오 |

배지 자리 / 색상은 동일한 plate-toolbar 컴포넌트 안이지만 *데이터 source 와 의미는 완전히 분리*. 사용자에게는 세 개가 나란히 뜸 — Plan 11B 가 머지된 후 본 PR 이 한 칸 더 추가하는 모양.

### 6.7 사이드바 진입점

`apps/web/src/components/sidebar/project-graph-link.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { Workflow } from "lucide-react";
import { useRouter, useParams } from "next/navigation";
import { useTabsStore } from "@/stores/tabs-store";
import { useCurrentProjectContext } from "./use-current-project";

export function ProjectGraphLink() {
  const t = useTranslations("sidebar.graph");
  const { projectId } = useCurrentProjectContext();
  const router = useRouter();
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const addTab = useTabsStore((s) => s.addTab);

  if (!projectId) return null;

  function open() {
    addTab({ kind: "project", mode: "graph", targetId: projectId, /* ... */ });
    router.push(`/w/${wsSlug}/p/${projectId}/graph`);
  }
  return (
    <button onClick={open} className="...ScopedSearch 와 동일 스타일...">
      <Workflow className="h-3.5 w-3.5" />
      <span>{t("entry")}</span>
    </button>
  );
}
```

`shell-sidebar.tsx` 안 ScopedSearch 바로 아래 삽입.

### 6.8 라우트 페이지 `app/[locale]/(shell)/w/[wsSlug]/p/[projectId]/graph/page.tsx`

App Shell URL 동기화 규칙 (§3.2) 대로 — URL 진입 시 해당 `(kind, targetId)` 탭이 있으면 활성화, 없으면 생성. 페이지 자체는 thin entrypoint:

```tsx
import { resolveProjectTab } from "@/lib/tab-resolvers";
export default async function GraphPage({ params }) {
  const { wsSlug, projectId } = await params;
  // server: validate + redirect if 403/404, then hand off to client tab manager
  return <ProjectGraphRouteEntry wsSlug={wsSlug} projectId={projectId} />;
}
```

`ProjectGraphRouteEntry` (client) 가 useEffect 로 `addOrActivate({ kind: 'project', mode: 'graph', targetId })` 호출.

> 참고: 이 패턴은 App Shell 의 다른 라우트 페이지 (예: `/w/<slug>/p/<projectId>` 프로젝트 뷰, `/w/<slug>/research/<runId>` Research 상세) 와 동일. 새로운 패턴 도입 아님.

---

## 7. i18n, Testing, Regression Guards

### 7.1 i18n (`messages/{ko,en}/graph.json`)

신규 파일, ko/en parity. Plan 9a 의 CI 가 자동 검증.

```json
// messages/ko/graph.json (스케치)
{
  "viewer": {
    "title": "그래프",
    "missing": "그래프를 표시할 프로젝트가 선택되지 않았습니다."
  },
  "filters": {
    "searchPlaceholder": "개념 이름으로 검색…",
    "relationLabel": "관계",
    "relationAll": "전체",
    "truncatedBanner": "{shown} / {total} 개념 표시 중. 검색·관계 필터로 좁히세요.",
    "showAllOver500": "노드 500개 이상 — 필터로 좁혀서 보세요."
  },
  "nodeMenu": {
    "openFirstNote": "노트 열기",
    "expand": "주변 펼치기"
  },
  "empty": {
    "title": "아직 그래프가 비어 있습니다",
    "body": "노트가 인제스트되면 자동으로 개념이 추출되어 여기에 나타납니다."
  },
  "errors": {
    "loadFailed": "그래프를 불러오지 못했습니다.",
    "tooManyHops": "이웃 펼치기 단계는 최대 3까지 가능합니다.",
    "forbidden": "이 프로젝트에 접근 권한이 없습니다."
  }
}

// messages/ko/sidebar.json — 기존 파일에 키 추가
{
  // ...
  "graph": {
    "entry": "이 프로젝트 그래프 보기"
  }
}

// messages/ko/note.json (또는 등가) — Backlinks Panel
{
  // ...
  "backlinks": {
    "title": "백링크",
    "empty": "이 노트를 가리키는 다른 노트가 없습니다.",
    "countAria": "{count}개의 백링크",
    "toggleAria": "백링크 패널 펼치기/접기"
  }
}
```

`appShell.tabTitles.graph` 키도 기존 `messages/*/appShell.json` 에 추가 (Plan 7 Canvas 가 `tabTitles.canvas` 추가하는 동일 패턴).

### 7.2 Vitest 단위 / 컴포넌트 테스트

`apps/web/src/components/graph/__tests__/`:

| 파일 | 검증 |
|---|---|
| `ProjectGraph.test.tsx` | concepts 0 → empty 컴포넌트 렌더, error → 에러 메시지, success → cytoscape elements 변환 검증 |
| `GraphFilters.test.tsx` | truncated=true 시 배너 표시, search 입력 → debounce 후 filter 콜백 |
| `useProjectGraph.test.ts` | TanStack Query 캐시 키, expand 머지 (중복 제거), error 전파 |
| `BacklinksPanel.test.tsx` | total=0 → empty UI, total>0 → row 렌더 + 클릭 시 addOrReplacePreview 호출 |
| `project-graph-viewer.test.tsx` | tab.targetId=null → missing UI, present → ProjectGraph 마운트 |
| `project-graph-link.test.tsx` | 클릭 시 router.push + addTab 호출 |
| `tab-mode-router.test.tsx` | mode='graph' → ProjectGraphViewer 렌더 (다른 모드 회귀 없음) |

`hocuspocus` 측:

| 파일 | 검증 |
|---|---|
| `wiki-link-sync.test.ts` | extractWikiLinkTargets — deep nested / 중복 / 비-UUID / 자기참조 / 빈 value / non-array root |
| `wiki-link-sync.integration.test.ts` | syncWikiLinks — 신규 / 변경 / 전체 삭제 (target=∅) / soft-deleted target skip / 중복 INSERT 무시 |

### 7.3 API 테스트 (Vitest, `apps/api`)

| 파일 | 검증 |
|---|---|
| `routes/graph.test.ts` | GET /graph 비-멤버 → 403, 빈 프로젝트 → 빈 응답, 500 초과 → truncated=true, relation 필터, order=recent |
| `routes/graph-expand.test.ts` | hops=4 → 400, conceptId 가 다른 project → 404, hops=2 정상 응답 |
| `routes/notes-backlinks.test.ts` | 본인 권한 노트 조회 정상, private source 노트는 응답에서 누락, target soft-deleted 시 응답 0 |

### 7.4 Playwright E2E (`apps/web/tests/e2e/graph.spec.ts`)

단일 spec — Plan 7 Canvas E2E 패턴. `/test-seed` 같은 보조 표면이 없으면 fixtures 시드.

- 사이드바 "이 프로젝트 그래프 보기" 클릭 → URL = `/w/<slug>/p/<projectId>/graph`, 탭 바에 "그래프" 표시
- 그래프 마운트 후 ≥ 1 노드 visible (Cytoscape DOM `[data-id]` selector)
- 노드 더블클릭 → preview tab 으로 source 노트 열림, plate 마운트
- Backlinks Panel 토글 (`⌘⇧B`) → 패널 visible/hidden 전환, 빈 상태 텍스트 또는 row 표시

Tab Mode Router 자동 매핑 회귀는 본 spec 영역 밖 (그래프는 노트가 아니라 auto-detect 안 함). Phase 2 의 `mindmap` 등이 추가되면 해당 PR 에서 회귀 가드 확장.

### 7.5 회귀 CI 가드

`.github/workflows/ci.yml` 의 lint 스텝에 추가:

```bash
# Cytoscape 패키지 latest 태그 / floating 버전 회귀 차단
! grep -RE "cytoscape(-fcose)?:?\\s*\\^?(latest|\\*)" \
  apps/web/package.json apps/web/src/

# Plate wiki-link 노드 type 키가 'wiki-link' 외로 변경되는 회귀 차단
# (extractWikiLinkTargets 가 의존)
grep -q "type: \"wiki-link\"" apps/web/src/components/editor/elements/wiki-link-element.tsx
grep -q "WIKILINK_KEY = \"wiki-link\"" apps/web/src/components/editor/plugins/wiki-link.tsx
```

### 7.6 ko/en parity

PR 머지 전 `pnpm --filter @opencairn/web i18n:parity` 실행. `graph.json` + 기타 추가 키 모두 ko/en 양쪽 존재 검증 (Plan 9a CI 자동).

---

## 8. 충돌 회피 (다른 세션과 병렬)

| 영역 | 본 세션 변경 | Plan 7 Canvas Phase 1 | App Shell Phase 4 (agent panel) | App Shell Phase 5 (palette) | Deep Research Phase E | 완화 |
|---|---|---|---|---|---|---|
| `tabs-store.ts` (TabMode union) | `'graph'` 추가 | `'canvas'` 추가 | (없음) | (없음) | (없음) | 알파벳 정렬 위치 다름 → 자동 머지 |
| `tab-mode-router.tsx` | `case 'graph'` | `case 'canvas'` | (없음) | (없음) | (없음) | 동일 파일 다른 case → 손쉬운 머지 |
| migration 번호 | 0020 (wiki_links) | 0020/0021 (canvas) | 가능성 낮음 | 0 | 0 | 늦은 PR 이 다음 번호로 rename + journal |
| `notes.ts` route | `/:id/backlinks` 추가 | `/:id/canvas` 추가 + POST 확장 | 없음 | 없음 | 없음 | 다른 sub-route → 충돌 0 |
| `panel-store.ts` | `backlinksOpen` 필드 | 없음 | 가능성 있음 (agent panel state) | 가능성 있음 (palette) | 없음 | 다른 필드 추가 → 손쉬운 머지 |
| i18n | `graph.json` 신규 + sidebar/note 키 | `canvas.json` 신규 | `agent-panel.json` 신규 | `palette.json` 신규 | `research.json` 변경 | 신규 파일 충돌 0; 기존 `sidebar.json`/`note.json` 키 추가는 줄 단위 머지 가능 |
| `shell-sidebar.tsx` | `<ProjectGraphLink />` 삽입 | 없음 | 없음 | 가능성 있음 (search 위치 변경) | 없음 | conflict 시 손쉽게 수동 머지 |
| `apps/hocuspocus/src/persistence.ts` | `syncWikiLinks` 호출 추가 | 없음 | 없음 | 없음 | 없음 | 안전 |

**격리 방법:** git worktree (`.worktrees/plan-5-kg`) 에서 작업 → main 변화에 자동 따라가지 않으므로 PR 시점에 rebase. Plan 7 Canvas 의 `.worktrees/canvas-phase-1` 와 동일 패턴.

---

## 9. Open Questions / Decisions

이 spec 은 다음을 **확정** 한다:

1. ✅ **Phase 1 = Graph view + Backlinks** — 5뷰 / Visualization Agent / cluster overlay 모두 Phase 2
2. ✅ **신규 tab mode `'graph'`** — `'mindmap'` 은 Phase 2 의 tree-layout 변형용으로 유보
3. ✅ **Cytoscape.js + react-cytoscapejs + cytoscape-fcose** (force-directed)
4. ✅ **노드 캡 500 + N-hop expand API** — 5K 프로젝트 RPS 보호
5. ✅ **wiki_links 인덱스 테이블** — JSONB 즉석 스캔 X
6. ✅ **Hocuspocus persistence.store inline sync** — atomicity, locality
7. ✅ **사이드바 진입점 = ScopedSearch 형제 버튼** ("이 프로젝트 그래프 보기")
8. ✅ **GraphDto.nodes[].firstNoteId 포함** — 클릭 시 추가 fetch 없이 점프
9. ✅ **LightRAG 미도입** — Compiler 가 이미 `concepts`/`concept_edges` 채우는 중
10. ✅ **Visualization Agent 이연** — Agent Runtime v2 Sub-B 머지 후

다음 Phase 에서 다룰 질문:

- 5뷰의 "Canvas" 명칭을 무엇으로 재명명할 것인가 (`board`? `freeform`?) — Plan 7 Canvas 와 충돌
- Visualization Agent 가 `runtime.Agent` 위에서 어떤 tool 들을 호출 (search_concepts, get_concept_graph, build_view_spec) — Sub-B 의 tool inventory 정의 후
- 크로스-프로젝트 워크스페이스 단위 그래프 — 별도 spec 필요 (권한 필터 복잡도 + 시각화 노드 수)
- KG 편집 UI (concept rename / merge / split) — 현재 Compiler 자동 추출과 어떻게 정합성 유지?
- Cluster overlay (Louvain) 가 클라이언트 cytoscape-leiden / 서버 사전계산 중 어디서?
- 이해도 점수 (Plan 6 SM-2 의존) — 그래프 노드 색상에 매핑할 시점

---

## 10. Verification (PR 머지 전 통과 기준)

- [ ] `pnpm --filter @opencairn/db migrate` 적용 → 기존 row 영향 0, backfill 정상
- [ ] `pnpm --filter @opencairn/db test` (wiki_links unique 제약 + cascade 단위)
- [ ] `pnpm --filter @opencairn/api test` (graph / expand / backlinks 신규 + 기존 회귀 0)
- [ ] `pnpm --filter @opencairn/hocuspocus test` (persistence + wiki-link-sync 통합)
- [ ] `pnpm --filter @opencairn/web test` (graph 컴포넌트 + viewer + sidebar entry + 회귀 0)
- [ ] `pnpm --filter @opencairn/web i18n:parity` (graph/sidebar/note 추가 키 ko/en)
- [ ] `pnpm --filter @opencairn/web playwright test graph.spec.ts`
- [ ] CI grep 가드 (cytoscape latest 태그, wiki-link 키 상수) 0 hit
- [ ] `pnpm --filter @opencairn/web build` 통과 (App Shell 라우트 + Cytoscape SSR 우회)
- [ ] 수동: 사이드바 "이 프로젝트 그래프 보기" → 새 탭 마운트 → 노드 더블클릭 → 노트 preview 열림
- [ ] 수동: 임의 노트에 wiki-link 삽입 → Yjs flush → 대상 노트의 Backlinks Panel 에 즉시 (≤2s) 반영

---

## 11. Phase 2 인계 (다음 세션)

- **추가 4뷰** (Mindmap tree / Cards / Timeline / 5뷰의 Canvas 재명명) — 각 뷰는 본 spec 의 `<ProjectGraph>` 옆에 view 토글로 들어가거나, 별도 tab mode 로 분기 (결정 필요)
- **Visualization Agent** (`runtime.Agent`) — Agent Runtime v2 Sub-B 머지 후. tool inventory: `search_concepts` / `get_concept_graph` / `emit_view_spec`. Temporal workflow `VisualizationWorkflow`
- **클러스터링** (Louvain) — 서버 사전계산 (concepts 변경 시 background job) 또는 client cytoscape-leiden, 트레이드오프 결정
- **이해도 점수 색상** — Plan 6 SM-2 review 데이터를 노드 색상에 매핑
- **KG 편집 UI** — concept rename / merge / split / 수동 edge 추가, Compiler 추출과 정합성 정책
- **크로스-프로젝트 그래프** — 워크스페이스 단위 통합 KG 별도 spec
- **inline graph Plate block** — Plan 10B 영역, 편집 중 노트에 인용 그래프 임베드

---

## 12. 변경 이력

- 2026-04-25: 최초 작성. Plan 5 v2026-04-09 plan 의 web Tasks 1~10 + M1 Visualization Agent 를 App Shell + Yjs canonical + Agent Runtime v2 + i18n parity 컨텍스트에 맞춰 Phase 1 (Graph 뷰 + Backlinks) 으로 재정의. LightRAG 가정 폐기 (Compiler 가 이미 채움).
