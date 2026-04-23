import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { createApp } from "../src/app.js";
import { db, concepts, eq } from "@opencairn/db";
import {
  seedMultiRoleWorkspace,
  type SeedMultiRoleResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

describe("GET /api/mentions/search", () => {
  let seed: SeedMultiRoleResult;

  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("user type returns workspace members filtered by prefix", async () => {
    const app = createApp();
    const r = await app.request(
      `/api/mentions/search?type=user&q=&workspaceId=${seed.workspaceId}`,
      { headers: { cookie: await signSessionCookie(seed.editorUserId) } },
    );
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(Array.isArray(json.results)).toBe(true);
    expect(json.results.length).toBeGreaterThan(0);
    expect(json.results.every((x: { type: string }) => x.type === "user")).toBe(
      true,
    );
    // All 4 seeded members (owner/editor/commenter/viewer) are scoped to this ws.
    const ids = json.results.map((x: { id: string }) => x.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        seed.ownerUserId,
        seed.editorUserId,
        seed.commenterUserId,
        seed.viewerUserId,
      ]),
    );
  });

  // Tier 0 item 0-3 (Plan 2B C-1): user mention search must NOT expose member
  // emails. The prior response leaked `sublabel = user.email`, which made the
  // autocomplete a silent PII enumeration primitive for any workspace member.
  it("user type does not expose member emails as sublabel", async () => {
    const app = createApp();
    const r = await app.request(
      `/api/mentions/search?type=user&q=&workspaceId=${seed.workspaceId}`,
      { headers: { cookie: await signSessionCookie(seed.editorUserId) } },
    );
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.results.length).toBeGreaterThan(0);
    for (const row of json.results as Array<Record<string, unknown>>) {
      expect(row).not.toHaveProperty("email");
      expect(row.sublabel).toBeUndefined();
      // Label must also not be an email string — fall back to name or id,
      // never the user's email even when name is null.
      expect(typeof row.label === "string" && row.label.includes("@")).toBe(
        false,
      );
    }
  });

  it("page type excludes notes the caller cannot read", async () => {
    const app = createApp();
    const r = await app.request(
      `/api/mentions/search?type=page&q=&workspaceId=${seed.workspaceId}`,
      { headers: { cookie: await signSessionCookie(seed.viewerUserId) } },
    );
    expect(r.status).toBe(200);
    const json = await r.json();
    // viewer has no page permission on privateNoteId and inheritParent=false there,
    // so it must not appear in the results.
    expect(
      json.results.some((x: { id: string }) => x.id === seed.privateNoteId),
    ).toBe(false);
    // The shared note with inheritParent=true IS readable → must appear.
    expect(
      json.results.some((x: { id: string }) => x.id === seed.noteId),
    ).toBe(true);
    expect(json.results.every((x: { type: string }) => x.type === "page")).toBe(
      true,
    );
  });

  it("rejects cross-workspace access", async () => {
    const app = createApp();
    const r = await app.request(
      `/api/mentions/search?type=user&q=&workspaceId=${seed.otherWorkspaceId}`,
      { headers: { cookie: await signSessionCookie(seed.editorUserId) } },
    );
    expect(r.status).toBe(403);
  });

  it("concept type returns concepts in readable workspace projects", async () => {
    // Seed a concept inside seed.projectId that the editor can read (via
    // project defaultRole="editor" → workspace membership="member" inherits).
    const conceptId = randomUUID();
    await db.insert(concepts).values({
      id: conceptId,
      projectId: seed.projectId,
      name: "Retrieval Augmented Generation",
      description: "",
    });

    try {
      const app = createApp();
      const r = await app.request(
        `/api/mentions/search?type=concept&q=Retrieval&workspaceId=${seed.workspaceId}`,
        { headers: { cookie: await signSessionCookie(seed.editorUserId) } },
      );
      expect(r.status).toBe(200);
      const json = await r.json();
      expect(
        json.results.some(
          (x: { id: string; type: string; label: string }) =>
            x.id === conceptId &&
            x.type === "concept" &&
            x.label === "Retrieval Augmented Generation",
        ),
      ).toBe(true);
    } finally {
      // Cleanup the concept explicitly — seed.cleanup cascades via project delete,
      // but this keeps the row gone even if concepts happen to survive cleanup.
      await db.delete(concepts).where(eq(concepts.id, conceptId));
    }
  });
});
