import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  db,
  synthesisRuns,
  synthesisDocuments,
  synthesisSources,
  notes,
  eq,
} from "@opencairn/db";

const SECRET = "test-internal-secret-synthesis-export";
process.env.INTERNAL_API_SECRET = SECRET;
process.env.PLAYWRIGHT_NO_SANDBOX = "1"; // for any pdf path that runs in test env

import { createApp } from "../../src/app.js";
import { seedWorkspace, type SeedResult } from "../helpers/seed.js";

const app = createApp();

const headers = {
  "X-Internal-Secret": SECRET,
  "Content-Type": "application/json",
};

async function createRun(workspaceId: string, userId: string): Promise<string> {
  const [row] = await db
    .insert(synthesisRuns)
    .values({
      workspaceId,
      userId,
      format: "docx",
      template: "report",
      userPrompt: "test prompt",
      autoSearch: false,
    })
    .returning();
  return row!.id;
}

describe("/api/internal/synthesis-export/*", () => {
  let seed: SeedResult;
  let runId: string;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
    runId = await createRun(seed.workspaceId, seed.userId);
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("compile rejects without internal secret", async () => {
    const res = await app.request("/api/internal/synthesis-export/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId, format: "md", output: {} }),
    });
    expect(res.status).toBe(401);
  });

  it("compile md returns s3Key + bytes", async () => {
    const res = await app.request("/api/internal/synthesis-export/compile", {
      method: "POST",
      headers,
      body: JSON.stringify({
        run_id: runId,
        format: "md",
        output: {
          format: "md",
          title: "T",
          abstract: null,
          sections: [{ title: "S", content: "c", source_ids: [] }],
          bibliography: [],
          template: "report",
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { s3Key: string; bytes: number };
    expect(body.s3Key).toContain(runId);
    expect(body.bytes).toBeGreaterThan(0);
  });

  it("documents endpoint inserts a row", async () => {
    const res = await app.request("/api/internal/synthesis-export/documents", {
      method: "POST",
      headers,
      body: JSON.stringify({
        run_id: runId,
        format: "zip",
        s3_key: `synthesis/runs/${runId}/test.zip`,
        bytes: 4096,
      }),
    });
    expect(res.status).toBe(200);
    const docs = await db
      .select()
      .from(synthesisDocuments)
      .where(eq(synthesisDocuments.runId, runId));
    expect(docs.find((d) => d.format === "zip")).toBeDefined();
  });

  it("PATCH /runs/:id updates tokens_used and status", async () => {
    const res = await app.request(
      `/api/internal/synthesis-export/runs/${runId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ tokens_used: 4321, status: "compiling" }),
      },
    );
    expect(res.status).toBe(200);
    const [run] = await db
      .select()
      .from(synthesisRuns)
      .where(eq(synthesisRuns.id, runId));
    expect(run!.tokensUsed).toBe(4321);
    expect(run!.status).toBe("compiling");
  });

  it("sources upserts rows", async () => {
    const sourceUuid1 = crypto.randomUUID();
    const sourceUuid2 = crypto.randomUUID();
    const res = await app.request("/api/internal/synthesis-export/sources", {
      method: "POST",
      headers,
      body: JSON.stringify({
        run_id: runId,
        rows: [
          {
            source_id: sourceUuid1,
            kind: "note",
            title: "n",
            token_count: 10,
            included: true,
          },
          {
            source_id: sourceUuid2,
            kind: "s3_object",
            title: "x",
            token_count: 99,
            included: false,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(synthesisSources)
      .where(eq(synthesisSources.runId, runId));
    expect(rows).toHaveLength(2);
  });

  it("fetch-source returns 404 for kind=note when the note doesn't exist", async () => {
    const res = await app.request(
      "/api/internal/synthesis-export/fetch-source",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ source_id: crypto.randomUUID(), kind: "note" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("fetch-source returns the note title + content for kind=note", async () => {
    const [n] = await db
      .insert(notes)
      .values({
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        title: "Seeded note",
        contentText: "note body for synthesis fetch",
      })
      .returning();

    const res = await app.request(
      "/api/internal/synthesis-export/fetch-source",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ source_id: n!.id, kind: "note" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      title: string;
      body: string;
      kind: string;
    };
    expect(body.id).toBe(n!.id);
    expect(body.title).toBe("Seeded note");
    expect(body.body).toContain("note body for synthesis fetch");
    expect(body.kind).toBe("note");
  });

  it("fetch-source falls back to a placeholder for kind=s3_object when no note matches", async () => {
    const fakeKey = crypto.randomUUID();
    const res = await app.request(
      "/api/internal/synthesis-export/fetch-source",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ source_id: fakeKey, kind: "s3_object" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      title: string;
      body: string;
      kind: string;
    };
    expect(body.id).toBe(fakeKey);
    expect(body.kind).toBe("s3_object");
    expect(body.body).toBe("");
  });

  it("fetch-source returns the linked note's content for kind=s3_object when sourceFileKey matches", async () => {
    const [n] = await db
      .insert(notes)
      .values({
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        title: "Ingested PDF",
        contentText: "extracted body of the PDF",
      })
      .returning();

    // The route's source_id is Zod-validated as a UUID. The worker passes
    // note UUIDs today (not raw S3 keys), so we look up by note id and
    // expect the s3_object branch to find the same row via sourceFileKey
    // when given a UUID-shaped key. Until the worker→API contract for
    // s3_object lands in Task 18, exercise the fallback by using a UUID
    // that we wrote into source_file_key:
    const fakeUuidKey = crypto.randomUUID();
    await db
      .update(notes)
      .set({ sourceFileKey: fakeUuidKey })
      .where(eq(notes.id, n!.id));

    const res = await app.request(
      "/api/internal/synthesis-export/fetch-source",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ source_id: fakeUuidKey, kind: "s3_object" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      title: string;
      body: string;
      kind: string;
    };
    expect(body.id).toBe(n!.id);
    expect(body.title).toBe("Ingested PDF");
    expect(body.body).toContain("extracted body of the PDF");
    expect(body.kind).toBe("s3_object");
  });

  it("fetch-source returns 404 for missing dr_result sources", async () => {
    const res = await app.request(
      "/api/internal/synthesis-export/fetch-source",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          source_id: crypto.randomUUID(),
          kind: "dr_result",
        }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("compile rejects format=latex via Zod (no API latex compile)", async () => {
    const res = await app.request("/api/internal/synthesis-export/compile", {
      method: "POST",
      headers,
      body: JSON.stringify({
        run_id: runId,
        format: "latex",
        output: {
          format: "latex",
          title: "T",
          abstract: null,
          sections: [],
          bibliography: [],
          template: "report",
        },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /runs/:id returns 404 when the run does not exist", async () => {
    const ghostId = crypto.randomUUID();
    const res = await app.request(
      `/api/internal/synthesis-export/runs/${ghostId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "completed" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("auto-search returns empty hits (real semantic search is a followup)", async () => {
    const res = await app.request(
      "/api/internal/synthesis-export/auto-search",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          workspace_id: seed.workspaceId,
          query: "x",
          limit: 5,
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: unknown[] };
    expect(body.hits).toEqual([]);
  });

  it("auto-search rejects an empty query string with 400", async () => {
    const res = await app.request(
      "/api/internal/synthesis-export/auto-search",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          workspace_id: seed.workspaceId,
          query: "",
          limit: 5,
        }),
      },
    );
    expect(res.status).toBe(400);
  });
});
