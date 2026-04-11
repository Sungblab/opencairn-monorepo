# Plan 5: Knowledge Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the `concepts` and `concept_edges` tables through Hono CRUD routes, add recursive-CTE graph traversal queries, and render the knowledge graph as an interactive D3.js force-directed graph in the Next.js frontend with click-to-wiki, edge add/remove, and relation-type/project-scope filters.

**Architecture:** All graph API logic lives in `apps/api/src/routes/` as standard Hono route modules, validated with Zod, and backed by `@opencairn/db` Drizzle queries. The frontend graph lives in `apps/web/src/components/graph/` as a React client component that fetches from the API, renders with D3.js `forceSimulation`, and drives wiki navigation via Next.js router. Graph state (selected node, filters) is managed with `useState`/`useReducer` — no external store needed.

**Tech Stack:** Hono 4, Drizzle ORM 0.45, Zod, D3.js 7, React 19, Next.js 16, TypeScript 5.x, `@opencairn/shared` for API types

---

## File Structure

```
apps/api/src/
  routes/
    concepts.ts              -- concept CRUD (GET list, GET :id, POST, PATCH, DELETE)
    concept-edges.ts         -- edge CRUD (GET by concept, POST, DELETE)
    graph.ts                 -- graph traversal endpoints (N-hop, full project graph)

packages/db/src/
  queries/
    concepts.ts              -- Drizzle queries: list, findById, create, update, delete
    concept-edges.ts         -- Drizzle queries: listByConceptId, create, delete
    graph.ts                 -- raw SQL: recursive CTE N-hop traversal

packages/shared/src/
  api-types.ts               -- extend with ConceptDto, EdgeDto, GraphDto Zod schemas

apps/web/src/
  components/
    graph/
      ForceGraph.tsx          -- D3 force simulation, SVG render (client component)
      GraphNode.tsx           -- SVG circle + label for a concept node
      GraphEdge.tsx           -- SVG line + label for an edge
      GraphControls.tsx       -- filter panel (relation type, project scope)
      useGraphData.ts         -- hook: fetch /graph, manage loading/error state
      useGraphSimulation.ts   -- hook: create + tick D3 forceSimulation
      graph.types.ts          -- local TS types (D3Node, D3Link, FilterState)
  app/
    (app)/
      projects/[projectId]/
        graph/
          page.tsx            -- server component shell, renders ForceGraph
```

---

### Task 1: Shared API Types for Concepts and Edges

**Files:**
- Modify: `packages/shared/src/api-types.ts`
- Test: manual type-check with `pnpm -F @opencairn/shared build`

- [ ] **Step 1: Read the current `api-types.ts`**

Open `packages/shared/src/api-types.ts` to see existing schemas before appending.

- [ ] **Step 2: Add Concept and Edge Zod schemas**

Append to the bottom of `packages/shared/src/api-types.ts`:

```typescript
// ─── Concept ────────────────────────────────────────────────────────────────

export const ConceptDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  summary: z.string().nullable(),
  aliases: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ConceptDto = z.infer<typeof ConceptDtoSchema>;

export const CreateConceptSchema = z.object({
  name: z.string().min(1).max(255),
  summary: z.string().optional(),
  aliases: z.array(z.string()).optional(),
});

export type CreateConceptInput = z.infer<typeof CreateConceptSchema>;

export const UpdateConceptSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  summary: z.string().optional(),
  aliases: z.array(z.string()).optional(),
});

export type UpdateConceptInput = z.infer<typeof UpdateConceptSchema>;

// ─── Concept Edge ────────────────────────────────────────────────────────────

export const EDGE_RELATIONS = [
  "is-a",
  "uses",
  "part-of",
  "contrasts-with",
  "related-to",
  "enables",
  "co-occurs",
] as const;

export type EdgeRelation = (typeof EDGE_RELATIONS)[number];

export const EdgeDtoSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  relation: z.enum(EDGE_RELATIONS),
  weight: z.number().min(0).max(10),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type EdgeDto = z.infer<typeof EdgeDtoSchema>;

export const CreateEdgeSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  relation: z.enum(EDGE_RELATIONS),
  weight: z.number().min(0).max(10).default(1.0),
});

export type CreateEdgeInput = z.infer<typeof CreateEdgeSchema>;

// ─── Graph ───────────────────────────────────────────────────────────────────

export const GraphDtoSchema = z.object({
  nodes: z.array(ConceptDtoSchema),
  edges: z.array(EdgeDtoSchema),
});

export type GraphDto = z.infer<typeof GraphDtoSchema>;
```

Note: `z` must already be imported at the top of the file. If it isn't, add `import { z } from 'zod';` at the top.

- [ ] **Step 3: Verify the package compiles**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm -F @opencairn/shared build
```

Expected: no TypeScript errors, `dist/` updated.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add packages/shared/src/api-types.ts
git commit -m "feat(shared): add Concept, Edge, Graph Zod schemas to api-types"
```

---

### Task 2: Drizzle DB Queries for Concepts

**Files:**
- Create: `packages/db/src/queries/concepts.ts`
- Create: `packages/db/src/queries/concept-edges.ts`
- Create: `packages/db/src/queries/graph.ts`
- Modify: `packages/db/src/index.ts` (re-export queries)

- [ ] **Step 1: Read `packages/db/src/schema/concepts.ts`**

Open `packages/db/src/schema/concepts.ts` to see the table column names before writing queries against them.

- [ ] **Step 2: Create `packages/db/src/queries/concepts.ts`**

```typescript
import { eq, and, ilike } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { concepts } from "../schema/concepts";
import type { CreateConceptInput, UpdateConceptInput } from "@opencairn/shared";

export async function listConcepts(
  db: NodePgDatabase<any>,
  projectId: string,
  opts: { search?: string; limit?: number; offset?: number } = {}
) {
  const { search, limit = 50, offset = 0 } = opts;

  const conditions = [eq(concepts.projectId, projectId)];
  if (search) {
    conditions.push(ilike(concepts.name, `%${search}%`));
  }

  return db
    .select({
      id: concepts.id,
      projectId: concepts.projectId,
      name: concepts.name,
      summary: concepts.summary,
      aliases: concepts.aliases,
      createdAt: concepts.createdAt,
      updatedAt: concepts.updatedAt,
    })
    .from(concepts)
    .where(and(...conditions))
    .limit(limit)
    .offset(offset)
    .orderBy(concepts.name);
}

export async function getConceptById(
  db: NodePgDatabase<any>,
  conceptId: string
) {
  const rows = await db
    .select()
    .from(concepts)
    .where(eq(concepts.id, conceptId))
    .limit(1);
  return rows[0] ?? null;
}

export async function createConcept(
  db: NodePgDatabase<any>,
  projectId: string,
  input: CreateConceptInput
) {
  const rows = await db
    .insert(concepts)
    .values({
      projectId,
      name: input.name,
      summary: input.summary ?? null,
      aliases: input.aliases ?? [],
    })
    .returning();
  return rows[0];
}

export async function updateConcept(
  db: NodePgDatabase<any>,
  conceptId: string,
  input: UpdateConceptInput
) {
  const rows = await db
    .update(concepts)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.summary !== undefined && { summary: input.summary }),
      ...(input.aliases !== undefined && { aliases: input.aliases }),
      updatedAt: new Date(),
    })
    .where(eq(concepts.id, conceptId))
    .returning();
  return rows[0] ?? null;
}

export async function deleteConcept(
  db: NodePgDatabase<any>,
  conceptId: string
): Promise<boolean> {
  const rows = await db
    .delete(concepts)
    .where(eq(concepts.id, conceptId))
    .returning({ id: concepts.id });
  return rows.length > 0;
}
```

- [ ] **Step 3: Create `packages/db/src/queries/concept-edges.ts`**

```typescript
import { eq, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { conceptEdges } from "../schema/concepts";
import type { CreateEdgeInput } from "@opencairn/shared";

export async function listEdgesForConcept(
  db: NodePgDatabase<any>,
  conceptId: string
) {
  return db
    .select()
    .from(conceptEdges)
    .where(or(eq(conceptEdges.sourceId, conceptId), eq(conceptEdges.targetId, conceptId)));
}

export async function createEdge(
  db: NodePgDatabase<any>,
  input: CreateEdgeInput
) {
  const rows = await db
    .insert(conceptEdges)
    .values({
      sourceId: input.sourceId,
      targetId: input.targetId,
      relation: input.relation,
      weight: input.weight ?? 1.0,
    })
    .onConflictDoUpdate({
      target: [conceptEdges.sourceId, conceptEdges.targetId, conceptEdges.relation],
      set: {
        weight: input.weight ?? 1.0,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0];
}

export async function deleteEdge(
  db: NodePgDatabase<any>,
  edgeId: string
): Promise<boolean> {
  const rows = await db
    .delete(conceptEdges)
    .where(eq(conceptEdges.id, edgeId))
    .returning({ id: conceptEdges.id });
  return rows.length > 0;
}
```

- [ ] **Step 4: Create `packages/db/src/queries/graph.ts`**

```typescript
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

export interface GraphRow {
  id: string;
  name: string;
  summary: string | null;
  aliases: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface EdgeRow {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  weight: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Fetch all concepts and edges for a project (full graph for the D3 view).
 */
export async function getFullProjectGraph(
  db: NodePgDatabase<any>,
  projectId: string
): Promise<{ nodes: GraphRow[]; edges: EdgeRow[] }> {
  const nodes = await db.execute<GraphRow>(sql`
    SELECT id, name, summary, aliases, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM concepts
    WHERE project_id = ${projectId}
    ORDER BY name
  `);

  const nodeIds = nodes.rows.map((n) => n.id);
  if (nodeIds.length === 0) return { nodes: nodes.rows, edges: [] };

  const edges = await db.execute<EdgeRow>(sql`
    SELECT id, source_id AS "sourceId", target_id AS "targetId",
           relation, weight,
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM concept_edges
    WHERE source_id = ANY(ARRAY[${sql.join(nodeIds.map((id) => sql`${id}::uuid`), sql`, `)}])
       OR target_id = ANY(ARRAY[${sql.join(nodeIds.map((id) => sql`${id}::uuid`), sql`, `)}])
  `);

  return { nodes: nodes.rows, edges: edges.rows };
}

/**
 * N-hop traversal from a seed concept using a recursive CTE.
 * Returns all concept IDs reachable within `maxHops` steps.
 */
export async function getNHopNeighbours(
  db: NodePgDatabase<any>,
  seedConceptId: string,
  maxHops: number = 2
): Promise<{ nodes: GraphRow[]; edges: EdgeRow[] }> {
  const result = await db.execute<{ concept_id: string }>(sql`
    WITH RECURSIVE traversal AS (
      -- Base: edges from the seed concept
      SELECT source_id, target_id, 1 AS depth
      FROM concept_edges
      WHERE source_id = ${seedConceptId}::uuid

      UNION ALL

      -- Recursive: follow outgoing edges, up to maxHops
      SELECT e.source_id, e.target_id, t.depth + 1
      FROM concept_edges e
      JOIN traversal t ON e.source_id = t.target_id
      WHERE t.depth < ${maxHops}
    )
    SELECT DISTINCT target_id AS concept_id FROM traversal
    UNION
    SELECT ${seedConceptId}::uuid AS concept_id
  `);

  const conceptIds = result.rows.map((r) => r.concept_id);
  if (conceptIds.length === 0) return { nodes: [], edges: [] };

  const nodes = await db.execute<GraphRow>(sql`
    SELECT id, name, summary, aliases, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM concepts
    WHERE id = ANY(ARRAY[${sql.join(conceptIds.map((id) => sql`${id}::uuid`), sql`, `)}])
  `);

  const edges = await db.execute<EdgeRow>(sql`
    SELECT id, source_id AS "sourceId", target_id AS "targetId",
           relation, weight,
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM concept_edges
    WHERE source_id = ANY(ARRAY[${sql.join(conceptIds.map((id) => sql`${id}::uuid`), sql`, `)}])
      AND target_id = ANY(ARRAY[${sql.join(conceptIds.map((id) => sql`${id}::uuid`), sql`, `)}])
  `);

  return { nodes: nodes.rows, edges: edges.rows };
}
```

- [ ] **Step 5: Re-export from `packages/db/src/index.ts`**

Open `packages/db/src/index.ts` and add to the exports:

```typescript
export * from "./queries/concepts";
export * from "./queries/concept-edges";
export * from "./queries/graph";
```

- [ ] **Step 6: Build the db package to catch type errors**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm -F @opencairn/db build
```

Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Sungbin\Documents\GitHub\opencairn-monorepo
git add packages/db/src/queries/ packages/db/src/index.ts
git commit -m "feat(db): add concept, edge, and graph traversal Drizzle queries"
```

---

### Task 3: Concept CRUD API Routes (Hono)

**Files:**
- Create: `apps/api/src/routes/concepts.ts`
- Modify: `apps/api/src/app.ts` (mount the router)

- [ ] **Step 1: Read `apps/api/src/app.ts`**

Open `apps/api/src/app.ts` to see how existing routes are mounted.

- [ ] **Step 2: Create `apps/api/src/routes/concepts.ts`**

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../lib/db";
import {
  listConcepts,
  getConceptById,
  createConcept,
  updateConcept,
  deleteConcept,
} from "@opencairn/db";
import {
  CreateConceptSchema,
  UpdateConceptSchema,
} from "@opencairn/shared";

// All concept routes are scoped to a project: /projects/:projectId/concepts
const conceptsRouter = new Hono();

// GET /projects/:projectId/concepts?search=&limit=&offset=
conceptsRouter.get(
  "/",
  zValidator(
    "query",
    z.object({
      search: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
  ),
  async (c) => {
    const { projectId } = c.req.param();
    const { search, limit, offset } = c.req.valid("query");
    const rows = await listConcepts(db, projectId, { search, limit, offset });
    return c.json({ data: rows });
  }
);

// GET /projects/:projectId/concepts/:conceptId
conceptsRouter.get("/:conceptId", async (c) => {
  const { conceptId } = c.req.param();
  const concept = await getConceptById(db, conceptId);
  if (!concept) return c.json({ error: "Not found" }, 404);
  return c.json({ data: concept });
});

// POST /projects/:projectId/concepts
conceptsRouter.post(
  "/",
  zValidator("json", CreateConceptSchema),
  async (c) => {
    const { projectId } = c.req.param();
    const input = c.req.valid("json");
    const concept = await createConcept(db, projectId, input);
    return c.json({ data: concept }, 201);
  }
);

// PATCH /projects/:projectId/concepts/:conceptId
conceptsRouter.patch(
  "/:conceptId",
  zValidator("json", UpdateConceptSchema),
  async (c) => {
    const { conceptId } = c.req.param();
    const input = c.req.valid("json");
    const updated = await updateConcept(db, conceptId, input);
    if (!updated) return c.json({ error: "Not found" }, 404);
    return c.json({ data: updated });
  }
);

// DELETE /projects/:projectId/concepts/:conceptId
conceptsRouter.delete("/:conceptId", async (c) => {
  const { conceptId } = c.req.param();
  const deleted = await deleteConcept(db, conceptId);
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export { conceptsRouter };
```

- [ ] **Step 3: Mount concepts router in `apps/api/src/app.ts`**

In `apps/api/src/app.ts`, add after the existing route imports:

```typescript
import { conceptsRouter } from "./routes/concepts";
```

And add the route mount inside the app definition (after auth middleware, scoped to projects):

```typescript
app.route("/projects/:projectId/concepts", conceptsRouter);
```

- [ ] **Step 4: Verify the API compiles**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm -F @opencairn/api build
```

Expected: no TypeScript errors.

- [ ] **Step 5: Smoke-test with curl (requires running docker compose)**

```bash
# Start dev services first if not running:
# docker compose up -d

curl -X POST http://localhost:4000/projects/YOUR_PROJECT_ID/concepts \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_SESSION_COOKIE" \
  -d '{"name":"Transformer","summary":"Attention-based sequence model."}'
# Expected: 201 with {data: {id: "...", name: "Transformer", ...}}

curl http://localhost:4000/projects/YOUR_PROJECT_ID/concepts
# Expected: 200 with {data: [{id: "...", name: "Transformer", ...}]}
```

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/api/src/routes/concepts.ts apps/api/src/app.ts
git commit -m "feat(api): add concept CRUD routes under /projects/:projectId/concepts"
```

---

### Task 4: Concept Edge CRUD + Graph Traversal API Routes

**Files:**
- Create: `apps/api/src/routes/concept-edges.ts`
- Create: `apps/api/src/routes/graph.ts`
- Modify: `apps/api/src/app.ts` (mount both routers)

- [ ] **Step 1: Create `apps/api/src/routes/concept-edges.ts`**

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../lib/db";
import { listEdgesForConcept, createEdge, deleteEdge } from "@opencairn/db";
import { CreateEdgeSchema } from "@opencairn/shared";

const edgesRouter = new Hono();

// GET /projects/:projectId/concepts/:conceptId/edges
edgesRouter.get("/:conceptId/edges", async (c) => {
  const { conceptId } = c.req.param();
  const edges = await listEdgesForConcept(db, conceptId);
  return c.json({ data: edges });
});

// POST /projects/:projectId/concepts/edges
edgesRouter.post(
  "/edges",
  zValidator("json", CreateEdgeSchema),
  async (c) => {
    const input = c.req.valid("json");
    const edge = await createEdge(db, input);
    return c.json({ data: edge }, 201);
  }
);

// DELETE /projects/:projectId/concepts/edges/:edgeId
edgesRouter.delete("/edges/:edgeId", async (c) => {
  const { edgeId } = c.req.param();
  const deleted = await deleteEdge(db, edgeId);
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export { edgesRouter };
```

- [ ] **Step 2: Create `apps/api/src/routes/graph.ts`**

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../lib/db";
import { getFullProjectGraph, getNHopNeighbours } from "@opencairn/db";

const graphRouter = new Hono();

// GET /projects/:projectId/graph
// Returns all nodes + edges for the project (full graph)
graphRouter.get(
  "/",
  zValidator(
    "query",
    z.object({
      relation: z.string().optional(),
    })
  ),
  async (c) => {
    const { projectId } = c.req.param();
    const { relation } = c.req.valid("query");
    const graph = await getFullProjectGraph(db, projectId);

    // Optional client-side relation filter
    const edges = relation
      ? graph.edges.filter((e) => e.relation === relation)
      : graph.edges;

    return c.json({ data: { nodes: graph.nodes, edges } });
  }
);

// GET /projects/:projectId/graph/nhop/:conceptId?hops=2
// Returns subgraph reachable within N hops from a seed concept
graphRouter.get(
  "/nhop/:conceptId",
  zValidator(
    "query",
    z.object({
      hops: z.coerce.number().int().min(1).max(5).default(2),
    })
  ),
  async (c) => {
    const { conceptId } = c.req.param();
    const { hops } = c.req.valid("query");
    const graph = await getNHopNeighbours(db, conceptId, hops);
    return c.json({ data: graph });
  }
);

export { graphRouter };
```

- [ ] **Step 3: Mount the two new routers in `apps/api/src/app.ts`**

```typescript
import { edgesRouter } from "./routes/concept-edges";
import { graphRouter } from "./routes/graph";

// ... inside app definition, after conceptsRouter:
app.route("/projects/:projectId/concepts", edgesRouter);
app.route("/projects/:projectId/graph", graphRouter);
```

- [ ] **Step 4: Build to verify**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm -F @opencairn/api build
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/api/src/routes/concept-edges.ts apps/api/src/routes/graph.ts apps/api/src/app.ts
git commit -m "feat(api): add concept edge CRUD and graph traversal routes"
```

---

### Task 5: Graph Local Types and Data Hook

**Files:**
- Create: `apps/web/src/components/graph/graph.types.ts`
- Create: `apps/web/src/components/graph/useGraphData.ts`

- [ ] **Step 1: Create `apps/web/src/components/graph/graph.types.ts`**

```typescript
import type { SimulationNodeDatum, SimulationLinkDatum } from "d3";
import type { ConceptDto, EdgeDto, EdgeRelation } from "@opencairn/shared";

/** A ConceptDto extended with D3 simulation position data. */
export interface D3Node extends SimulationNodeDatum, ConceptDto {
  id: string;
}

/** An EdgeDto extended for D3 link simulation. */
export interface D3Link extends SimulationLinkDatum<D3Node> {
  id: string;
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  weight: number;
}

export interface FilterState {
  relation: EdgeRelation | "all";
  search: string;
}

export interface GraphState {
  nodes: D3Node[];
  links: D3Link[];
  selectedNodeId: string | null;
  filters: FilterState;
}
```

- [ ] **Step 2: Create `apps/web/src/components/graph/useGraphData.ts`**

```typescript
"use client";

import { useEffect, useState } from "react";
import type { GraphDto } from "@opencairn/shared";
import type { D3Node, D3Link, FilterState } from "./graph.types";

interface UseGraphDataResult {
  nodes: D3Node[];
  links: D3Link[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useGraphData(
  projectId: string,
  filters: FilterState
): UseGraphDataResult {
  const [rawGraph, setRawGraph] = useState<GraphDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    setIsLoading(true);

    const params = new URLSearchParams();
    if (filters.relation !== "all") {
      params.set("relation", filters.relation);
    }

    fetch(`/api/projects/${projectId}/graph?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ data: GraphDto }>;
      })
      .then(({ data }) => {
        setRawGraph(data);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [projectId, filters.relation, tick]);

  const nodes: D3Node[] = (rawGraph?.nodes ?? [])
    .filter((n) =>
      filters.search
        ? n.name.toLowerCase().includes(filters.search.toLowerCase())
        : true
    )
    .map((n) => ({ ...n }));

  const nodeIds = new Set(nodes.map((n) => n.id));

  const links: D3Link[] = (rawGraph?.edges ?? [])
    .filter((e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))
    .map((e) => ({
      ...e,
      source: e.sourceId,
      target: e.targetId,
    }));

  return {
    nodes,
    links,
    isLoading,
    error,
    refetch: () => setTick((t) => t + 1),
  };
}
```

- [ ] **Step 3: Verify TypeScript in web package**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm -F @opencairn/web tsc --noEmit
```

Expected: no errors (or only pre-existing errors, not from the new files).

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/web/src/components/graph/graph.types.ts \
        apps/web/src/components/graph/useGraphData.ts
git commit -m "feat(web): add graph types and useGraphData hook"
```

---

### Task 6: D3 Force Simulation Hook

**Files:**
- Create: `apps/web/src/components/graph/useGraphSimulation.ts`

- [ ] **Step 1: Install D3**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm -F @opencairn/web add d3
pnpm -F @opencairn/web add -D @types/d3
```

- [ ] **Step 2: Create `apps/web/src/components/graph/useGraphSimulation.ts`**

```typescript
"use client";

import { useEffect, useRef, MutableRefObject } from "react";
import * as d3 from "d3";
import type { D3Node, D3Link } from "./graph.types";

interface SimulationResult {
  svgRef: MutableRefObject<SVGSVGElement | null>;
}

export function useGraphSimulation(
  nodes: D3Node[],
  links: D3Link[],
  width: number,
  height: number,
  onNodeClick: (nodeId: string) => void
): SimulationResult {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Keep stable copies so the effect can reference them without re-running
  const nodesRef = useRef(nodes);
  const linksRef = useRef(links);
  nodesRef.current = nodes;
  linksRef.current = links;

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Arrow marker for directed edges
    svg
      .append("defs")
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 18)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#94a3b8");

    const g = svg.append("g").attr("class", "graph-root");

    // Zoom + pan
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    // Clone node/link data to avoid mutating props
    const simNodes: D3Node[] = nodes.map((n) => ({ ...n }));
    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

    const simLinks = links.map((l) => ({
      ...l,
      source: nodeMap.get(l.sourceId) ?? l.sourceId,
      target: nodeMap.get(l.targetId) ?? l.targetId,
    }));

    const simulation = d3
      .forceSimulation<D3Node>(simNodes)
      .force(
        "link",
        d3
          .forceLink<D3Node, (typeof simLinks)[0]>(simLinks)
          .id((d) => d.id)
          .distance((l) => 80 + 40 / (l.weight ?? 1))
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide(28));

    // Edge lines
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", "#94a3b8")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d) => Math.sqrt(d.weight ?? 1))
      .attr("marker-end", "url(#arrow)");

    // Edge labels
    const edgeLabel = g
      .append("g")
      .attr("class", "edge-labels")
      .selectAll("text")
      .data(simLinks)
      .join("text")
      .attr("font-size", 9)
      .attr("fill", "#64748b")
      .attr("text-anchor", "middle")
      .text((d) => d.relation);

    // Node circles
    const node = g
      .append("g")
      .attr("class", "nodes")
      .selectAll<SVGCircleElement, D3Node>("circle")
      .data(simNodes)
      .join("circle")
      .attr("r", 14)
      .attr("fill", "#6366f1")
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("click", (_event, d) => onNodeClick(d.id))
      .call(
        d3
          .drag<SVGCircleElement, D3Node>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Node labels
    const label = g
      .append("g")
      .attr("class", "node-labels")
      .selectAll("text")
      .data(simNodes)
      .join("text")
      .attr("font-size", 11)
      .attr("fill", "#1e293b")
      .attr("text-anchor", "middle")
      .attr("dy", 26)
      .text((d) => d.name);

    // Tick handler
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as D3Node).x ?? 0)
        .attr("y1", (d) => (d.source as D3Node).y ?? 0)
        .attr("x2", (d) => (d.target as D3Node).x ?? 0)
        .attr("y2", (d) => (d.target as D3Node).y ?? 0);

      edgeLabel
        .attr(
          "x",
          (d) =>
            (((d.source as D3Node).x ?? 0) + ((d.target as D3Node).x ?? 0)) / 2
        )
        .attr(
          "y",
          (d) =>
            (((d.source as D3Node).y ?? 0) + ((d.target as D3Node).y ?? 0)) / 2
        );

      node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);

      label.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, links, width, height, onNodeClick]);

  return { svgRef };
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm -F @opencairn/web tsc --noEmit
```

Expected: no errors in `useGraphSimulation.ts`.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/web/src/components/graph/useGraphSimulation.ts
git commit -m "feat(web): add D3 force simulation hook with zoom, drag, and arrow markers"
```

---

### Task 7: Graph Sub-components

**Files:**
- Create: `apps/web/src/components/graph/GraphControls.tsx`
- Create: `apps/web/src/components/graph/GraphEdgePanel.tsx`

- [ ] **Step 1: Create `apps/web/src/components/graph/GraphControls.tsx`**

```tsx
"use client";

import { EDGE_RELATIONS, type EdgeRelation } from "@opencairn/shared";
import type { FilterState } from "./graph.types";

interface GraphControlsProps {
  filters: FilterState;
  onFilterChange: (next: Partial<FilterState>) => void;
}

export function GraphControls({ filters, onFilterChange }: GraphControlsProps) {
  return (
    <div className="flex gap-3 items-center flex-wrap p-3 bg-white border-b border-slate-200">
      {/* Search */}
      <input
        type="search"
        placeholder="Search concepts..."
        value={filters.search}
        onChange={(e) => onFilterChange({ search: e.target.value })}
        className="border border-slate-300 rounded px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />

      {/* Relation filter */}
      <select
        value={filters.relation}
        onChange={(e) =>
          onFilterChange({ relation: e.target.value as EdgeRelation | "all" })
        }
        className="border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <option value="all">All relations</option>
        {EDGE_RELATIONS.map((rel) => (
          <option key={rel} value={rel}>
            {rel}
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/components/graph/GraphEdgePanel.tsx`**

This panel appears when a node is selected and lets the user add or remove edges.

```tsx
"use client";

import { useState } from "react";
import { EDGE_RELATIONS, type EdgeRelation, type EdgeDto } from "@opencairn/shared";

interface GraphEdgePanelProps {
  selectedNodeId: string;
  selectedNodeName: string;
  existingEdges: EdgeDto[];
  projectId: string;
  onEdgeAdded: () => void;
  onEdgeRemoved: () => void;
}

export function GraphEdgePanel({
  selectedNodeId,
  selectedNodeName,
  existingEdges,
  projectId,
  onEdgeAdded,
  onEdgeRemoved,
}: GraphEdgePanelProps) {
  const [targetId, setTargetId] = useState("");
  const [relation, setRelation] = useState<EdgeRelation>("related-to");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAddEdge(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/concepts/edges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: selectedNodeId,
          targetId,
          relation,
          weight: 1.0,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setTargetId("");
      onEdgeAdded();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemoveEdge(edgeId: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}/concepts/edges/${edgeId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      onEdgeRemoved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <div className="p-4 bg-white border-l border-slate-200 w-72 flex flex-col gap-4 overflow-y-auto">
      <h3 className="font-semibold text-slate-800 truncate">{selectedNodeName}</h3>

      {/* Add edge form */}
      <form onSubmit={handleAddEdge} className="flex flex-col gap-2">
        <label className="text-xs text-slate-500 uppercase tracking-wide">Add edge</label>
        <input
          placeholder="Target concept ID"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          required
          className="border border-slate-300 rounded px-2 py-1.5 text-sm"
        />
        <select
          value={relation}
          onChange={(e) => setRelation(e.target.value as EdgeRelation)}
          className="border border-slate-300 rounded px-2 py-1.5 text-sm"
        >
          {EDGE_RELATIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-indigo-600 text-white rounded px-3 py-1.5 text-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {isSubmitting ? "Adding..." : "Add edge"}
        </button>
      </form>

      {/* Existing edges */}
      {existingEdges.length > 0 && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">
            Edges ({existingEdges.length})
          </label>
          {existingEdges.map((edge) => (
            <div
              key={edge.id}
              className="flex items-center justify-between text-sm gap-2"
            >
              <span className="truncate text-slate-700">
                {edge.relation} → {edge.targetId === selectedNodeId ? edge.sourceId : edge.targetId}
              </span>
              <button
                onClick={() => handleRemoveEdge(edge.id)}
                className="text-red-400 hover:text-red-600 shrink-0"
                aria-label="Remove edge"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build to verify**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm -F @opencairn/web tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/web/src/components/graph/GraphControls.tsx \
        apps/web/src/components/graph/GraphEdgePanel.tsx
git commit -m "feat(web): add GraphControls filter panel and GraphEdgePanel for edge management"
```

---

### Task 8: ForceGraph Main Component

**Files:**
- Create: `apps/web/src/components/graph/ForceGraph.tsx`

- [ ] **Step 1: Create `apps/web/src/components/graph/ForceGraph.tsx`**

```tsx
"use client";

import { useReducer, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EdgeDto } from "@opencairn/shared";
import type { FilterState, GraphState } from "./graph.types";
import { useGraphData } from "./useGraphData";
import { useGraphSimulation } from "./useGraphSimulation";
import { GraphControls } from "./GraphControls";
import { GraphEdgePanel } from "./GraphEdgePanel";

type GraphAction =
  | { type: "SET_SELECTED"; nodeId: string | null }
  | { type: "SET_FILTERS"; filters: Partial<FilterState> };

function graphReducer(state: GraphState, action: GraphAction): GraphState {
  switch (action.type) {
    case "SET_SELECTED":
      return { ...state, selectedNodeId: action.nodeId };
    case "SET_FILTERS":
      return { ...state, filters: { ...state.filters, ...action.filters } };
    default:
      return state;
  }
}

const INITIAL_FILTERS: FilterState = { relation: "all", search: "" };

interface ForceGraphProps {
  projectId: string;
  /** When a node is clicked, the page can navigate to the wiki entry. */
  wikiBasePath?: string;
}

export function ForceGraph({ projectId, wikiBasePath }: ForceGraphProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(graphReducer, {
    nodes: [],
    links: [],
    selectedNodeId: null,
    filters: INITIAL_FILTERS,
  });

  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const { nodes, links, isLoading, error, refetch } = useGraphData(
    projectId,
    state.filters
  );

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      dispatch({ type: "SET_SELECTED", nodeId });
      if (wikiBasePath) {
        router.push(`${wikiBasePath}/${nodeId}`);
      }
    },
    [router, wikiBasePath]
  );

  const { svgRef } = useGraphSimulation(
    nodes,
    links,
    containerSize.width,
    containerSize.height,
    handleNodeClick
  );

  // Fetch edges for the selected node for the side panel
  const [selectedEdges, setSelectedEdges] = useState<EdgeDto[]>([]);
  const selectedNode = nodes.find((n) => n.id === state.selectedNodeId);
  useEffect(() => {
    if (!state.selectedNodeId) {
      setSelectedEdges([]);
      return;
    }
    fetch(
      `/api/projects/${projectId}/concepts/${state.selectedNodeId}/edges`
    )
      .then((r) => r.json())
      .then((json: { data: EdgeDto[] }) => setSelectedEdges(json.data))
      .catch(() => setSelectedEdges([]));
  }, [state.selectedNodeId, projectId]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500">
        Failed to load graph: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <GraphControls
        filters={state.filters}
        onFilterChange={(next) => dispatch({ type: "SET_FILTERS", filters: next })}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Graph canvas */}
        <div
          ref={containerRef}
          className="flex-1 relative bg-slate-50"
        >
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
              Loading graph…
            </div>
          )}
          <svg
            ref={svgRef}
            width={containerSize.width}
            height={containerSize.height}
            className="w-full h-full"
          />
          {nodes.length === 0 && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
              No concepts yet. Add notes to populate the knowledge graph.
            </div>
          )}
        </div>

        {/* Side panel: shown only when a node is selected */}
        {state.selectedNodeId && selectedNode && (
          <GraphEdgePanel
            selectedNodeId={state.selectedNodeId}
            selectedNodeName={selectedNode.name}
            existingEdges={selectedEdges}
            projectId={projectId}
            onEdgeAdded={() => {
              refetch();
              // Re-fetch edges for the panel too
              dispatch({ type: "SET_SELECTED", nodeId: state.selectedNodeId });
            }}
            onEdgeRemoved={() => {
              refetch();
              dispatch({ type: "SET_SELECTED", nodeId: state.selectedNodeId });
            }}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm -F @opencairn/web tsc --noEmit
```

Expected: no errors in `ForceGraph.tsx`.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/web/src/components/graph/ForceGraph.tsx
git commit -m "feat(web): add ForceGraph component with node click, edge panel, and filter integration"
```

---

### Task 9: Graph Page Route

**Files:**
- Create: `apps/web/src/app/(app)/projects/[projectId]/graph/page.tsx`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/web/src/app/\(app\)/projects/\[projectId\]/graph
```

- [ ] **Step 2: Create `page.tsx`**

```tsx
import { ForceGraph } from "@/components/graph/ForceGraph";

interface GraphPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function GraphPage({ params }: GraphPageProps) {
  const { projectId } = await params;

  return (
    <div className="h-[calc(100vh-4rem)]">
      <ForceGraph
        projectId={projectId}
        wikiBasePath={`/projects/${projectId}/wiki`}
      />
    </div>
  );
}

export async function generateMetadata({ params }: GraphPageProps) {
  const { projectId } = await params;
  return {
    title: `Knowledge Graph — ${projectId}`,
  };
}
```

- [ ] **Step 3: Add `/api` proxy rewrite to `next.config.ts`**

Open `apps/web/next.config.ts` and add a rewrite so `/api/*` calls forward to the Hono API server:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://localhost:4000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 4: Add `API_URL` to `.env.example` in web**

```bash
echo "API_URL=http://localhost:4000" >> /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo/apps/web/.env.example
```

- [ ] **Step 5: Build the web app to verify**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm -F @opencairn/web build
```

Expected: successful Next.js build, route `/projects/[projectId]/graph` listed in output.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/web/src/app/\(app\)/projects/\[projectId\]/graph/page.tsx \
        apps/web/next.config.ts \
        apps/web/.env.example
git commit -m "feat(web): add /projects/[projectId]/graph page with ForceGraph and API proxy"
```

---

### Task 10: API Proxy Route Handler (Next.js → Hono passthrough)

> The rewrite in Task 9 handles local dev. For Vercel production, the frontend needs a Next.js Route Handler that proxies `/api/*` to the Hono backend URL set in `NEXT_PUBLIC_API_URL`.

**Files:**
- Create: `apps/web/src/app/api/[...path]/route.ts`

- [ ] **Step 1: Create the catch-all proxy route**

```typescript
// apps/web/src/app/api/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  // Strip the leading /api prefix that Next.js routes through
  const upstream = `${API_URL}${pathname.replace(/^\/api/, "")}${search}`;

  const headers = new Headers(req.headers);
  headers.delete("host");

  const upstreamRes = await fetch(upstream, {
    method: req.method,
    headers,
    body: req.body,
    // @ts-expect-error -- Node.js fetch supports duplex
    duplex: "half",
  });

  return new NextResponse(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const PUT = proxy;
```

- [ ] **Step 2: Build to verify**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
pnpm -F @opencairn/web build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/Sungbin/Documents/GitHub/opencairn-monorepo
git add apps/web/src/app/api/\[...path\]/route.ts
git commit -m "feat(web): add catch-all API proxy route handler for Hono backend"
```
