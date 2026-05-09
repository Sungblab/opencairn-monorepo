import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { canWrite } from "../lib/permissions";
import {
  moveTreeNode,
  renameTreeNode,
  resolveProjectForNode,
} from "../lib/project-tree-service";
import { emitTreeEvent } from "../lib/tree-events";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

const moveTreeNodeSchema = z.object({
  parentId: z.string().uuid().nullable(),
  position: z.number().int().min(0).default(0),
});

const renameTreeNodeSchema = z.object({
  label: z.string().trim().min(1).max(300),
});

export const projectTreeRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .patch("/nodes/:id", zValidator("json", renameTreeNodeSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    const node = await resolveProjectForNode(id);
    if (!node) return c.json({ error: "not_found" }, 404);
    if (!(await canWrite(user.id, { type: "project", id: node.projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = c.req.valid("json");
    try {
      const updated = await renameTreeNode({
        projectId: node.projectId,
        nodeId: id,
        label: body.label,
      });
      emitTreeEvent({
        kind: "tree.node_renamed",
        projectId: node.projectId,
        id,
        parentId: updated.parentId,
        label: updated.label,
        at: new Date().toISOString(),
      });
      return c.json({ node: updated });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  })
  .patch("/nodes/:id/move", zValidator("json", moveTreeNodeSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    const node = await resolveProjectForNode(id);
    if (!node) return c.json({ error: "not_found" }, 404);
    if (!(await canWrite(user.id, { type: "project", id: node.projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = c.req.valid("json");
    try {
      const updated = await moveTreeNode({
        projectId: node.projectId,
        nodeId: id,
        newParentId: body.parentId,
        position: body.position,
      });
      emitTreeEvent({
        kind: "tree.node_moved",
        projectId: node.projectId,
        id,
        parentId: updated.parentId,
        label: updated.label,
        at: new Date().toISOString(),
      });
      return c.json({ node: updated });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });
