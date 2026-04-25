import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  researchApi,
  researchKeys,
} from "./api-client-research";

describe("researchApi", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("createRun POSTs to /api/research/runs", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ runId: "r1" }), { status: 201 }),
    );
    const res = await researchApi.createRun({
      workspaceId: "w1",
      projectId: "p1",
      topic: "x",
      model: "deep-research-preview-04-2026",
      billingPath: "byok",
    });
    expect(res).toEqual({ runId: "r1" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/api\/research\/runs$/);
    expect(init?.method).toBe("POST");
  });

  it("listRuns GETs with workspaceId query param", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ runs: [] }), { status: 200 }),
    );
    await researchApi.listRuns("w1");
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/api\/research\/runs\?workspaceId=w1/);
  });

  it("getRun GETs /runs/:id", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "r1" }), { status: 200 }),
    );
    await researchApi.getRun("r1");
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/api\/research\/runs\/r1$/);
  });

  it("addTurn POSTs feedback", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ turnId: "t" }), { status: 202 }),
    );
    await researchApi.addTurn("r1", "feedback");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/runs\/r1\/turns$/);
    expect(JSON.parse(init?.body as string)).toEqual({ feedback: "feedback" });
  });

  it("updatePlan PATCHes /runs/:id/plan", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ turnId: "t" }), { status: 200 }),
    );
    await researchApi.updatePlan("r1", "edited");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/runs\/r1\/plan$/);
    expect(init?.method).toBe("PATCH");
  });

  it("approve POSTs to /runs/:id/approve", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ approved: true }), { status: 202 }),
    );
    await researchApi.approve("r1");
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/runs\/r1\/approve$/);
  });

  it("cancel POSTs to /runs/:id/cancel", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ cancelled: true }), { status: 202 }),
    );
    await researchApi.cancel("r1");
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/runs\/r1\/cancel$/);
  });

  it("researchKeys produces deterministic query keys", () => {
    expect(researchKeys.list("w1")).toEqual(["research", "list", "w1"]);
    expect(researchKeys.detail("r1")).toEqual(["research", "detail", "r1"]);
  });
});
