import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { db, flashcards, reviewLogs, eq, and } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function authedFetch(
  path: string,
  init: RequestInit & { userId: string },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

describe("Learning API — Flashcard CRUD", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("POST creates a flashcard in the project", async () => {
    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/flashcards`,
      {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({ front: "What is hoisting?", back: "Vars are hoisted." }),
      },
    );
    expect(res.status).toBe(201);
    const card = await res.json();
    expect(card.front).toBe("What is hoisting?");
    expect(card.back).toBe("Vars are hoisted.");
    expect(card.deckName).toBe("default");
    expect(card.projectId).toBe(ctx.projectId);
  });

  it("POST creates a flashcard with custom deckName", async () => {
    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/flashcards`,
      {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({ front: "Q", back: "A", deckName: "JavaScript" }),
      },
    );
    expect(res.status).toBe(201);
    const card = await res.json();
    expect(card.deckName).toBe("JavaScript");
  });

  it("POST 403 when viewer tries to create", async () => {
    const viewerCtx = await seedWorkspace({ role: "viewer" });
    try {
      const res = await authedFetch(
        `/api/projects/${viewerCtx.projectId}/learn/flashcards`,
        {
          method: "POST",
          userId: viewerCtx.userId,
          body: JSON.stringify({ front: "Q", back: "A" }),
        },
      );
      expect(res.status).toBe(403);
    } finally {
      await viewerCtx.cleanup();
    }
  });

  it("GET lists flashcards for the project", async () => {
    await db.insert(flashcards).values([
      { projectId: ctx.projectId, front: "F1", back: "B1" },
      { projectId: ctx.projectId, front: "F2", back: "B2", deckName: "deck2" },
    ]);
    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/flashcards`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const cards = await res.json();
    expect(cards.length).toBeGreaterThanOrEqual(2);
  });

  it("GET ?deck= filters by deck name", async () => {
    await db.insert(flashcards).values([
      { projectId: ctx.projectId, front: "F1", back: "B1", deckName: "alpha" },
      { projectId: ctx.projectId, front: "F2", back: "B2", deckName: "beta" },
    ]);
    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/flashcards?deck=alpha`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const cards = await res.json();
    expect(cards.every((c: { deckName: string }) => c.deckName === "alpha")).toBe(true);
  });

  it("GET /due returns cards with nextReview <= now", async () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    const [c1] = await db
      .insert(flashcards)
      .values({ projectId: ctx.projectId, front: "Due", back: "B", nextReview: past })
      .returning();
    await db
      .insert(flashcards)
      .values({ projectId: ctx.projectId, front: "Future", back: "B", nextReview: future });

    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/flashcards/due`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const cards = await res.json();
    const ids = cards.map((c: { id: string }) => c.id);
    expect(ids).toContain(c1.id);
    const futureCard = cards.find((c: { front: string }) => c.front === "Future");
    expect(futureCard).toBeUndefined();
  });

  it("GET /:id returns the card", async () => {
    const [card] = await db
      .insert(flashcards)
      .values({ projectId: ctx.projectId, front: "F", back: "B" })
      .returning();
    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/flashcards/${card.id}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(card.id);
  });

  it("GET /:id 404 for non-existent card", async () => {
    const fakeId = crypto.randomUUID();
    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/flashcards/${fakeId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(404);
  });

  it("PATCH /:id updates front/back", async () => {
    const [card] = await db
      .insert(flashcards)
      .values({ projectId: ctx.projectId, front: "Old Front", back: "Old Back" })
      .returning();
    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/flashcards/${card.id}`,
      {
        method: "PATCH",
        userId: ctx.userId,
        body: JSON.stringify({ front: "New Front" }),
      },
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.front).toBe("New Front");
    expect(updated.back).toBe("Old Back");
  });

  it("DELETE /:id removes the card", async () => {
    const [card] = await db
      .insert(flashcards)
      .values({ projectId: ctx.projectId, front: "F", back: "B" })
      .returning();
    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/flashcards/${card.id}`,
      { method: "DELETE", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const rows = await db.select().from(flashcards).where(eq(flashcards.id, card.id));
    expect(rows).toHaveLength(0);
  });
});

describe("Learning API — SM-2 Review", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("quality=3 (good) advances interval and creates review log", async () => {
    const [card] = await db
      .insert(flashcards)
      .values({ projectId: ctx.projectId, front: "F", back: "B", reviewCount: 0, intervalDays: 1 })
      .returning();

    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/flashcards/${card.id}/review`,
      {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({ quality: 3 }),
      },
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.reviewCount).toBe(1);
    expect(updated.intervalDays).toBe(1); // rep=0 → 1 day
    expect(new Date(updated.nextReview) > new Date()).toBe(true);

    const logs = await db
      .select()
      .from(reviewLogs)
      .where(eq(reviewLogs.flashcardId, card.id));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.rating).toBe(3);
  });

  it("quality=1 (blackout) resets repetitions to 0", async () => {
    const [card] = await db
      .insert(flashcards)
      .values({ projectId: ctx.projectId, front: "F", back: "B", reviewCount: 3, intervalDays: 15, easeFactor: 2.5 })
      .returning();

    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/flashcards/${card.id}/review`,
      {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({ quality: 1 }),
      },
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.reviewCount).toBe(0);
    expect(updated.intervalDays).toBe(1); // blackout resets to 1 day
  });

  it("quality=4 (easy) increases ease factor", async () => {
    const [card] = await db
      .insert(flashcards)
      .values({ projectId: ctx.projectId, front: "F", back: "B", reviewCount: 1, intervalDays: 6, easeFactor: 2.5 })
      .returning();

    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/flashcards/${card.id}/review`,
      {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({ quality: 4 }),
      },
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.easeFactor).toBeGreaterThan(2.5); // easy increases EF
    expect(updated.reviewCount).toBe(2);
  });

  it("review 400 for invalid quality", async () => {
    const [card] = await db
      .insert(flashcards)
      .values({ projectId: ctx.projectId, front: "F", back: "B" })
      .returning();
    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/flashcards/${card.id}/review`,
      {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({ quality: 5 }),
      },
    );
    expect(res.status).toBe(400);
  });
});

describe("Learning API — Deck Aggregation", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("GET /decks returns empty array when no cards", async () => {
    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/decks`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const decks = await res.json();
    expect(Array.isArray(decks)).toBe(true);
    expect(decks).toHaveLength(0);
  });

  it("GET /decks aggregates cards by deckName", async () => {
    await db.insert(flashcards).values([
      { projectId: ctx.projectId, front: "F1", back: "B1", deckName: "JS" },
      { projectId: ctx.projectId, front: "F2", back: "B2", deckName: "JS" },
      { projectId: ctx.projectId, front: "F3", back: "B3", deckName: "Python" },
    ]);

    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/decks`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const decks = await res.json();
    expect(decks).toHaveLength(2);
    const js = decks.find((d: { deckName: string }) => d.deckName === "JS");
    expect(js.total).toBe(2);
    const py = decks.find((d: { deckName: string }) => d.deckName === "Python");
    expect(py.total).toBe(1);
  });

  it("GET /decks 403 for non-member", async () => {
    const otherCtx = await seedWorkspace({ role: "editor" });
    try {
      const res = await authedFetch(
        `/api/projects/${ctx.projectId}/learn/decks`,
        { method: "GET", userId: otherCtx.userId },
      );
      expect(res.status).toBe(403);
    } finally {
      await otherCtx.cleanup();
    }
  });
});

describe("Learning API — Understanding Scores", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("GET /scores returns empty array when no scores", async () => {
    const res = await authedFetch(
      `/api/projects/${ctx.projectId}/learn/scores`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const scores = await res.json();
    expect(Array.isArray(scores)).toBe(true);
  });

  it("GET /scores 403 for non-member", async () => {
    const otherCtx = await seedWorkspace({ role: "editor" });
    try {
      const res = await authedFetch(
        `/api/projects/${ctx.projectId}/learn/scores`,
        { method: "GET", userId: otherCtx.userId },
      );
      expect(res.status).toBe(403);
    } finally {
      await otherCtx.cleanup();
    }
  });
});
