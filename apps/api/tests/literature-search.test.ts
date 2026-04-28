import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import * as litSearch from "../src/lib/literature-search.js";
import { _resetRateLimits } from "../src/lib/rate-limit.js";

describe("GET /api/literature/search", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "editor" });
    _resetRateLimits();
  });

  afterEach(async () => {
    await seed.cleanup();
    vi.restoreAllMocks();
    _resetRateLimits();
  });

  it("returns federated results for authenticated workspace member", async () => {
    vi.spyOn(litSearch, "federatedSearch").mockResolvedValue({
      results: [
        {
          id: "10.1234/test",
          doi: "10.1234/test",
          arxivId: null,
          title: "Test Paper",
          authors: ["Alice"],
          year: 2023,
          abstract: "Abstract text",
          source: "arxiv",
          openAccessPdfUrl: "https://arxiv.org/pdf/1234.pdf",
          citationCount: 5,
          alreadyImported: false,
        },
      ],
      sourceMeta: [{ name: "arxiv", count: 1 }],
    });

    const app = createApp();
    const res = await app.request(
      `/api/literature/search?q=test&workspaceId=${seed.workspaceId}`,
      { headers: { cookie: await signSessionCookie(seed.userId) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { doi: string }[];
      total: number;
      sources: { name: string; count: number }[];
    };
    expect(body.results).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.results[0].doi).toBe("10.1234/test");
    expect(body.sources).toEqual([{ name: "arxiv", count: 1 }]);
  });

  it("returns 400 when q is missing", async () => {
    const app = createApp();
    const res = await app.request(
      `/api/literature/search?workspaceId=${seed.workspaceId}`,
      { headers: { cookie: await signSessionCookie(seed.userId) } },
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 for unauthenticated requests", async () => {
    const app = createApp();
    const res = await app.request(
      `/api/literature/search?q=test&workspaceId=${seed.workspaceId}`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not a workspace member", async () => {
    // Build a second workspace and try to search it with the first user's
    // cookie. resolveRole(workspace) for a non-member returns "none" → 403.
    const other = await seedWorkspace({ role: "owner" });
    try {
      const app = createApp();
      const res = await app.request(
        `/api/literature/search?q=test&workspaceId=${other.workspaceId}`,
        { headers: { cookie: await signSessionCookie(seed.userId) } },
      );
      expect(res.status).toBe(403);
    } finally {
      await other.cleanup();
    }
  });

  it("returns 429 when per-workspace rate limit exhausted", async () => {
    vi.spyOn(litSearch, "federatedSearch").mockResolvedValue({
      results: [],
      sourceMeta: [],
    });
    const app = createApp();
    const cookie = await signSessionCookie(seed.userId);

    // Drain the 60 req/60s bucket. Each request runs the workspace
    // membership check + a stubbed federation call, so the cumulative
    // wall-clock cost is dominated by Better Auth + Drizzle round-trips.
    for (let i = 0; i < 60; i += 1) {
      const r = await app.request(
        `/api/literature/search?q=test&workspaceId=${seed.workspaceId}`,
        { headers: { cookie } },
      );
      expect(r.status).toBe(200);
    }

    const res = await app.request(
      `/api/literature/search?q=test&workspaceId=${seed.workspaceId}`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { retryAfterSec: number };
    expect(body.retryAfterSec).toBeGreaterThan(0);
  });

  it("respects sources query parameter", async () => {
    const spy = vi.spyOn(litSearch, "federatedSearch").mockResolvedValue({
      results: [],
      sourceMeta: [],
    });
    const app = createApp();
    const res = await app.request(
      `/api/literature/search?q=test&workspaceId=${seed.workspaceId}&sources=crossref`,
      { headers: { cookie: await signSessionCookie(seed.userId) } },
    );
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ["crossref"] }),
    );
  });
});
