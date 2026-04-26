import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, concepts, eq, and, sql } from "@opencairn/db";
import {
  graphQuerySchema,
  type GraphResponse,
  type GraphLayout,
  graphExpandQuerySchema,
  type GraphExpandResponse,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { expandFromConcept } from "../lib/expand-graph";
import {
  selectGraphView,
  selectMindmapBfs,
  selectMaxDegreeConcept,
  selectConceptsByRecency,
  selectConceptsByCreatedAsc,
  selectOneHopNeighborhood,
  projectOwnsConcept,
} from "../lib/graph-views";
import type { AppEnv } from "../lib/types";

// Plan 5 Phase 2 view caps (mirrored in the design spec §4.1 table). Edge
// caps for cards/timeline are 0 because those views do not render edges.
const MINDMAP_DEPTH = 3;
const MINDMAP_PER_PARENT_CAP = 8;
const MINDMAP_TOTAL_CAP = 50;
const CARDS_LIMIT = 80;
const TIMELINE_LIMIT = 50;
const BOARD_CAP = 200;

// concept_edges / concept_notes / notes are referenced via raw SQL string
// literals in db.execute() calls below; only `concepts` needs a Drizzle
// schema accessor for the typed seed-existence SELECT.
export const graphRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  // GET /api/projects/:projectId/graph
  .get(
    "/:projectId/graph",
    zValidator("query", graphQuerySchema),
    async (c) => {
      const user = c.get("user");
      const projectId = c.req.param("projectId");
      if (!isUuid(projectId)) return c.json({ error: "bad-request" }, 400);
      if (!(await canRead(user.id, { type: "project", id: projectId }))) {
        return c.json({ error: "forbidden" }, 403);
      }
      const { limit, order, relation, view, root } = c.req.valid("query");

      // Total concepts is shared across all views — drives `truncated` for
      // graph/board/mindmap and is echoed for cards/timeline so the client
      // can show "showing N of M" copy.
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(concepts)
        .where(eq(concepts.projectId, projectId));

      // ─── view dispatch ────────────────────────────────────────────────
      // The `view=graph` branch is regression-zero against Phase 1. Other
      // branches reuse the `selectGraphView` -> nodes/edges fetch helpers
      // and only diverge in their selection strategy + layout hint.
      let payload: GraphResponse;
      if (view === "graph") {
        const { nodes, edges } = await selectGraphView({
          projectId,
          limit,
          order,
          relation,
        });
        payload = {
          nodes,
          edges,
          truncated: total > limit,
          totalConcepts: total,
          viewType: "graph",
          layout: "fcose",
          rootId: null,
        };
      } else if (view === "mindmap") {
        // root validation: explicit root must belong to the path project
        // (resource scope leak guard). Auto-select max-degree concept when
        // omitted; null result means the project has zero concepts and the
        // empty-tree branch below applies.
        let rootId: string | null = null;
        if (root) {
          if (!(await projectOwnsConcept(projectId, root))) {
            return c.json({ error: "not-found" }, 404);
          }
          rootId = root;
        } else {
          rootId = await selectMaxDegreeConcept(projectId);
        }
        if (!rootId) {
          payload = {
            nodes: [],
            edges: [],
            truncated: false,
            totalConcepts: total,
            viewType: "mindmap",
            layout: "dagre",
            rootId: null,
          };
        } else {
          const { nodes, edges } = await selectMindmapBfs({
            projectId,
            rootId,
            depth: MINDMAP_DEPTH,
            perParentCap: MINDMAP_PER_PARENT_CAP,
            totalCap: MINDMAP_TOTAL_CAP,
          });
          payload = {
            nodes,
            edges,
            truncated: total > nodes.length,
            totalConcepts: total,
            viewType: "mindmap",
            layout: "dagre",
            rootId,
          };
        }
      } else if (view === "cards") {
        const nodes = await selectConceptsByRecency({
          projectId,
          limit: CARDS_LIMIT,
        });
        payload = {
          nodes,
          edges: [],
          truncated: total > CARDS_LIMIT,
          totalConcepts: total,
          viewType: "cards",
          layout: "preset",
          rootId: null,
        };
      } else if (view === "timeline") {
        const nodes = await selectConceptsByCreatedAsc({
          projectId,
          limit: TIMELINE_LIMIT,
        });
        payload = {
          nodes,
          edges: [],
          truncated: total > TIMELINE_LIMIT,
          totalConcepts: total,
          viewType: "timeline",
          layout: "preset",
          rootId: null,
        };
      } else {
        // view === "board"
        // root is optional. With a root: 1-hop neighborhood. Without:
        // top-N by degree (board falls back to the Phase 1 graph fetch with
        // a 200-node cap, edges among the chosen nodes only).
        let rootId: string | null = null;
        let nodes;
        let edges;
        if (root) {
          if (!(await projectOwnsConcept(projectId, root))) {
            return c.json({ error: "not-found" }, 404);
          }
          rootId = root;
          ({ nodes, edges } = await selectOneHopNeighborhood({
            projectId,
            rootId,
            cap: BOARD_CAP,
          }));
        } else {
          ({ nodes, edges } = await selectGraphView({
            projectId,
            limit: Math.min(limit, BOARD_CAP),
            order: "degree",
            relation,
          }));
        }
        payload = {
          nodes,
          edges,
          truncated: total > nodes.length,
          totalConcepts: total,
          viewType: "board",
          layout: "preset",
          rootId,
        };
      }

      // The `as GraphLayout` cast is a no-op runtime — keeps the literal
      // unions narrowed for the response body type.
      void (payload.layout satisfies GraphLayout);
      return c.json(payload);
    },
  )

  // GET /api/projects/:projectId/graph/expand/:conceptId
  .get(
    "/:projectId/graph/expand/:conceptId",
    zValidator("query", graphExpandQuerySchema),
    async (c) => {
      const user = c.get("user");
      const projectId = c.req.param("projectId");
      const conceptId = c.req.param("conceptId");
      if (!isUuid(projectId) || !isUuid(conceptId)) {
        return c.json({ error: "bad-request" }, 400);
      }
      if (!(await canRead(user.id, { type: "project", id: projectId }))) {
        return c.json({ error: "forbidden" }, 403);
      }
      const { hops } = c.req.valid("query");

      // Seed must belong to the path projectId — prevents cross-project leak.
      const [seed] = await db
        .select({ id: concepts.id })
        .from(concepts)
        .where(and(eq(concepts.id, conceptId), eq(concepts.projectId, projectId)));
      if (!seed) return c.json({ error: "not-found" }, 404);

      // BFS + node/edge fetch shared with the internal-only Plan 5 Phase 2
      // route at /api/internal/projects/:id/graph/expand. See
      // ../lib/expand-graph.ts.
      const body: GraphExpandResponse = await expandFromConcept(
        projectId,
        conceptId,
        hops,
      );
      return c.json(body);
    },
  );
