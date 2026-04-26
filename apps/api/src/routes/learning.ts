import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  db,
  flashcards,
  reviewLogs,
  understandingScores,
  concepts,
  eq,
  and,
  lte,
  count,
  sql,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

// ── SM-2 algorithm ────────────────────────────────────────────────────────────
// quality maps to SM-2 q: 1→0, 2→2, 3→4, 4→5
// EF' = EF + (0.1 - (5-q)*(0.08 + (5-q)*0.02)), min 1.3
// interval: q<3 → reset to 1d; rep=0 → 1d; rep=1 → 6d; rep≥2 → round(prev*EF)
function sm2(
  quality: number,
  repetitions: number,
  easeFactor: number,
  intervalDays: number,
): { nextIntervalDays: number; nextEF: number; nextReps: number } {
  const q = quality === 1 ? 0 : quality === 2 ? 2 : quality === 3 ? 4 : 5;
  const nextEF = Math.max(1.3, easeFactor + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (q < 3) {
    return { nextIntervalDays: 1, nextEF, nextReps: 0 };
  }
  let nextIntervalDays: number;
  if (repetitions === 0) nextIntervalDays = 1;
  else if (repetitions === 1) nextIntervalDays = 6;
  else nextIntervalDays = Math.round(intervalDays * easeFactor);
  return { nextIntervalDays, nextEF, nextReps: repetitions + 1 };
}

const createFlashcardSchema = z.object({
  conceptId: z.string().uuid().optional(),
  noteId: z.string().uuid().optional(),
  deckName: z.string().max(100).default("default"),
  front: z.string().min(1).max(2000),
  back: z.string().min(1).max(4000),
});

const reviewSchema = z.object({
  quality: z.number().int().min(1).max(4),
});

export const learningRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  // ── Flashcard CRUD ──────────────────────────────────────────────────────────

  .post(
    "/:projectId/learn/flashcards",
    zValidator("json", createFlashcardSchema),
    async (c) => {
      const userId = c.get("userId");
      const projectId = c.req.param("projectId");
      if (!isUuid(projectId)) return c.json({ error: "bad-request" }, 400);
      if (!(await canWrite(userId, { type: "project", id: projectId }))) {
        return c.json({ error: "forbidden" }, 403);
      }
      const body = c.req.valid("json");
      const [card] = await db
        .insert(flashcards)
        .values({ projectId, ...body })
        .returning();
      return c.json(card, 201);
    },
  )

  .get("/:projectId/learn/flashcards", async (c) => {
    const userId = c.get("userId");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "bad-request" }, 400);
    if (!(await canRead(userId, { type: "project", id: projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const deck = c.req.query("deck");
    const where = deck
      ? and(eq(flashcards.projectId, projectId), eq(flashcards.deckName, deck))
      : eq(flashcards.projectId, projectId);
    const cards = await db.select().from(flashcards).where(where);
    return c.json(cards);
  })

  .get("/:projectId/learn/flashcards/due", async (c) => {
    const userId = c.get("userId");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "bad-request" }, 400);
    if (!(await canRead(userId, { type: "project", id: projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
    const cards = await db
      .select()
      .from(flashcards)
      .where(and(eq(flashcards.projectId, projectId), lte(flashcards.nextReview, new Date())))
      .limit(limit);
    return c.json(cards);
  })

  .get("/:projectId/learn/flashcards/:id", async (c) => {
    const userId = c.get("userId");
    const projectId = c.req.param("projectId");
    const id = c.req.param("id");
    if (!isUuid(projectId) || !isUuid(id)) return c.json({ error: "bad-request" }, 400);
    if (!(await canRead(userId, { type: "project", id: projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [card] = await db
      .select()
      .from(flashcards)
      .where(and(eq(flashcards.id, id), eq(flashcards.projectId, projectId)));
    if (!card) return c.json({ error: "not-found" }, 404);
    return c.json(card);
  })

  .patch(
    "/:projectId/learn/flashcards/:id",
    zValidator("json", createFlashcardSchema.partial()),
    async (c) => {
      const userId = c.get("userId");
      const projectId = c.req.param("projectId");
      const id = c.req.param("id");
      if (!isUuid(projectId) || !isUuid(id)) return c.json({ error: "bad-request" }, 400);
      if (!(await canWrite(userId, { type: "project", id: projectId }))) {
        return c.json({ error: "forbidden" }, 403);
      }
      const body = c.req.valid("json");
      const [updated] = await db
        .update(flashcards)
        .set(body)
        .where(and(eq(flashcards.id, id), eq(flashcards.projectId, projectId)))
        .returning();
      if (!updated) return c.json({ error: "not-found" }, 404);
      return c.json(updated);
    },
  )

  .delete("/:projectId/learn/flashcards/:id", async (c) => {
    const userId = c.get("userId");
    const projectId = c.req.param("projectId");
    const id = c.req.param("id");
    if (!isUuid(projectId) || !isUuid(id)) return c.json({ error: "bad-request" }, 400);
    if (!(await canWrite(userId, { type: "project", id: projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [deleted] = await db
      .delete(flashcards)
      .where(and(eq(flashcards.id, id), eq(flashcards.projectId, projectId)))
      .returning();
    if (!deleted) return c.json({ error: "not-found" }, 404);
    return c.json({ success: true });
  })

  // ── SM-2 Review ─────────────────────────────────────────────────────────────

  .post(
    "/:projectId/learn/flashcards/:id/review",
    zValidator("json", reviewSchema),
    async (c) => {
      const userId = c.get("userId");
      const projectId = c.req.param("projectId");
      const id = c.req.param("id");
      if (!isUuid(projectId) || !isUuid(id)) return c.json({ error: "bad-request" }, 400);
      if (!(await canWrite(userId, { type: "project", id: projectId }))) {
        return c.json({ error: "forbidden" }, 403);
      }
      const { quality } = c.req.valid("json");

      const [card] = await db
        .select()
        .from(flashcards)
        .where(and(eq(flashcards.id, id), eq(flashcards.projectId, projectId)));
      if (!card) return c.json({ error: "not-found" }, 404);

      const { nextIntervalDays, nextEF, nextReps } = sm2(
        quality,
        card.reviewCount,
        card.easeFactor,
        card.intervalDays,
      );

      const nextReview = new Date();
      nextReview.setDate(nextReview.getDate() + nextIntervalDays);

      const updated = await db.transaction(async (tx) => {
        const [card] = await tx
          .update(flashcards)
          .set({
            reviewCount: nextReps,
            intervalDays: nextIntervalDays,
            easeFactor: nextEF,
            nextReview,
          })
          .where(eq(flashcards.id, id))
          .returning();
        await tx.insert(reviewLogs).values({
          flashcardId: id,
          rating: quality,
        });
        return card;
      });

      return c.json(updated);
    },
  )

  // ── Deck aggregation ─────────────────────────────────────────────────────────
  // Returns per-deck counts without loading all card data into the client.

  .get("/:projectId/learn/decks", async (c) => {
    const userId = c.get("userId");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "bad-request" }, 400);
    if (!(await canRead(userId, { type: "project", id: projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const rows = await db
      .select({
        deckName: flashcards.deckName,
        total: count(flashcards.id),
        due: sql<number>`count(*) filter (where ${flashcards.nextReview} <= now())`,
      })
      .from(flashcards)
      .where(eq(flashcards.projectId, projectId))
      .groupBy(flashcards.deckName);
    return c.json(rows);
  })

  // ── Understanding Scores ─────────────────────────────────────────────────────
  // Scoped to the project via JOIN on concepts.projectId.

  .get("/:projectId/learn/scores", async (c) => {
    const userId = c.get("userId");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "bad-request" }, 400);
    if (!(await canRead(userId, { type: "project", id: projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const scores = await db
      .select({
        id: understandingScores.id,
        conceptId: understandingScores.conceptId,
        score: understandingScores.score,
        lastAssessed: understandingScores.lastAssessed,
      })
      .from(understandingScores)
      .innerJoin(concepts, eq(understandingScores.conceptId, concepts.id))
      .where(
        and(
          eq(understandingScores.userId, userId),
          eq(concepts.projectId, projectId),
        ),
      );
    return c.json(scores);
  });
