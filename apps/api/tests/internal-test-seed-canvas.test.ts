import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { db, notes, eq } from "@opencairn/db";

const SECRET = "test-internal-secret-canvas";
process.env.INTERNAL_API_SECRET = SECRET;

const app = createApp();

describe("POST /api/internal/test-seed canvas-phase2 mode", () => {
  it("seeds a canvas note and returns ids", async () => {
    const res = await app.request("/api/internal/test-seed", {
      method: "POST",
      headers: {
        "X-Internal-Secret": SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "canvas-phase2" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.userId).toBe("string");
    expect(typeof body.workspaceId).toBe("string");
    expect(typeof body.projectId).toBe("string");
    expect(typeof body.noteId).toBe("string");
    expect(typeof body.sessionCookie).toBe("string");

    // Verify the seeded canvas note actually carries canvas metadata so the
    // notes_canvas_language_check constraint was satisfied at insert time.
    const rows = await db
      .select({
        id: notes.id,
        sourceType: notes.sourceType,
        canvasLanguage: notes.canvasLanguage,
        contentText: notes.contentText,
      })
      .from(notes)
      .where(eq(notes.id, body.noteId as string));
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceType).toBe("canvas");
    expect(rows[0].canvasLanguage).toBe("python");
    expect(rows[0].contentText).toBe("print('hello')");
  });

  it("rejects without X-Internal-Secret header", async () => {
    const res = await app.request("/api/internal/test-seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "canvas-phase2" }),
    });
    expect(res.status).toBe(401);
  });
});
