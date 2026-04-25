import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, concepts, eq, sql } from "@opencairn/db";
import {
  graphQuerySchema,
  type GraphResponse,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

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
      const { limit, order, relation } = c.req.valid("query");

      // Total concepts for the truncated banner.
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(concepts)
        .where(eq(concepts.projectId, projectId));

      // Top-N concepts. Degree = inbound + outbound edges (cross apply
      // concept_edges twice). For "recent" we just sort by created_at desc.
      const orderClause =
        order === "recent"
          ? sql`c.created_at DESC`
          : sql`(SELECT count(*)::int
                 FROM concept_edges e
                 WHERE e.source_id = c.id OR e.target_id = c.id) DESC,
                c.name ASC`;

      // For each concept: id, name, description, degree, noteCount, firstNoteId.
      // firstNoteId = LEFT JOIN concept_notes ORDER BY notes.created_at LIMIT 1.
      type NodeRow = {
        id: string;
        name: string;
        description: string | null;
        degree: number;
        note_count: number;
        first_note_id: string | null;
      };
      const nodeRaw = await db.execute(sql`
        SELECT
          c.id,
          c.name,
          c.description,
          (SELECT count(*)::int FROM concept_edges e
            WHERE e.source_id = c.id OR e.target_id = c.id) AS degree,
          (SELECT count(*)::int FROM concept_notes cn
            WHERE cn.concept_id = c.id) AS note_count,
          (SELECT cn.note_id FROM concept_notes cn
            JOIN notes n ON n.id = cn.note_id
            WHERE cn.concept_id = c.id AND n.deleted_at IS NULL
            ORDER BY n.created_at ASC LIMIT 1) AS first_note_id
        FROM concepts c
        WHERE c.project_id = ${projectId}
        ORDER BY ${orderClause}
        LIMIT ${limit}
      `);
      const nodeRows = (
        (nodeRaw as unknown as { rows: NodeRow[] }).rows ??
        (nodeRaw as unknown as NodeRow[])
      );

      type EdgeRow = { id: string; source_id: string; target_id: string; relation_type: string; weight: number };
      const nodeIds = nodeRows.map((r) => r.id);
      let edgeRows: EdgeRow[] = [];
      if (nodeIds.length > 0) {
        const idArr = sql.join(
          nodeIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        );
        const relationFilter = relation ? sql`AND e.relation_type = ${relation}` : sql``;
        const edgeRaw = await db.execute(sql`
          SELECT e.id, e.source_id, e.target_id, e.relation_type, e.weight
          FROM concept_edges e
          WHERE e.source_id = ANY(ARRAY[${idArr}])
            AND e.target_id = ANY(ARRAY[${idArr}])
            ${relationFilter}
        `);
        edgeRows = (
          (edgeRaw as unknown as { rows: EdgeRow[] }).rows ??
          (edgeRaw as unknown as EdgeRow[])
        );
      }

      const body: GraphResponse = {
        nodes: nodeRows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description ?? "",
          degree: r.degree,
          noteCount: r.note_count,
          firstNoteId: r.first_note_id,
        })),
        edges: edgeRows.map((r) => ({
          id: r.id,
          sourceId: r.source_id,
          targetId: r.target_id,
          relationType: r.relation_type,
          weight: Number(r.weight),
        })),
        truncated: total > limit,
        totalConcepts: total,
      };
      return c.json(body);
    },
  );
