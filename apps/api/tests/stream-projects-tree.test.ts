import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import {
  emitTreeEvent,
  _listenerCountForTest,
} from "../src/lib/tree-events.js";

const app = createApp();

async function openStream(
  projectId: string,
  userId: string,
): Promise<{ res: Response; controller: AbortController }> {
  const cookie = await signSessionCookie(userId);
  const controller = new AbortController();
  const res = await app.request(`/api/stream/projects/${projectId}/tree`, {
    headers: { cookie },
    signal: controller.signal,
  });
  return { res, controller };
}

// Parse lines of an SSE body into an array of event names. Consumer keeps
// reading until the AbortController is triggered or `stop` returns true.
async function collectEvents(
  res: Response,
  stop: (events: string[]) => boolean,
  timeoutMs = 2000,
): Promise<string[]> {
  const events: string[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const read = reader.read();
    const timer = new Promise<{ done: true; value?: undefined }>((resolve) =>
      setTimeout(() => resolve({ done: true }), Math.max(10, deadline - Date.now())),
    );
    const winner = await Promise.race([read, timer]);
    if ("done" in winner && winner.done) break;
    const { value } = winner as { value?: Uint8Array };
    if (!value) break;
    for (const line of decoder.decode(value).split("\n")) {
      if (line.startsWith("event: ")) events.push(line.slice(7));
    }
    if (stop(events)) return events;
  }
  return events;
}

describe("GET /api/stream/projects/:projectId/tree", () => {
  const cleanups: SeedResult[] = [];
  afterEach(async () => {
    for (const s of cleanups.splice(0)) await s.cleanup();
  });

  it("returns 403 for non-members", async () => {
    const inside = await seedWorkspace({ role: "owner" });
    const outside = await seedWorkspace({ role: "owner" });
    cleanups.push(inside, outside);

    const { res, controller } = await openStream(
      inside.projectId,
      outside.userId,
    );
    expect(res.status).toBe(403);
    controller.abort();
    // Drain body to avoid keeping the response open.
    try { await res.body?.cancel(); } catch {}
  });

  it("returns 400 for non-uuid projectId", async () => {
    const seed = await seedWorkspace({ role: "owner" });
    cleanups.push(seed);
    const { res, controller } = await openStream("not-a-uuid", seed.userId);
    expect(res.status).toBe(400);
    controller.abort();
    try { await res.body?.cancel(); } catch {}
  });

  it("streams a ready event on connect", async () => {
    const seed = await seedWorkspace({ role: "owner" });
    cleanups.push(seed);

    const { res, controller } = await openStream(
      seed.projectId,
      seed.userId,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await collectEvents(
      res,
      (evs) => evs.includes("ready"),
      1500,
    );
    expect(events).toContain("ready");
    controller.abort();
    try { await res.body?.cancel(); } catch {}
  });

  it("forwards tree.folder_created events to the subscriber", async () => {
    const seed = await seedWorkspace({ role: "owner" });
    cleanups.push(seed);

    const { res, controller } = await openStream(
      seed.projectId,
      seed.userId,
    );
    const collector = collectEvents(
      res,
      (evs) => evs.includes("tree.folder_created"),
      2000,
    );

    // Wait a tick so the subscriber is registered before emitting.
    await vi.waitFor(
      () => expect(_listenerCountForTest(seed.projectId)).toBeGreaterThan(0),
      { timeout: 1000 },
    );

    emitTreeEvent({
      kind: "tree.folder_created",
      projectId: seed.projectId,
      id: "00000000-0000-0000-0000-000000000001",
      parentId: null,
      label: "hello",
      at: new Date().toISOString(),
    });

    const events = await collector;
    expect(events).toContain("tree.folder_created");
    controller.abort();
    try { await res.body?.cancel(); } catch {}
  });

  it("isolates events across projects", async () => {
    const a = await seedWorkspace({ role: "owner" });
    const b = await seedWorkspace({ role: "owner" });
    cleanups.push(a, b);

    const { res, controller } = await openStream(a.projectId, a.userId);
    const collector = collectEvents(
      res,
      (evs) => evs.filter((e) => e === "tree.note_created").length >= 1,
      1000,
    );

    await vi.waitFor(
      () => expect(_listenerCountForTest(a.projectId)).toBeGreaterThan(0),
      { timeout: 1000 },
    );

    // Emit against project B. Subscriber for A should NOT receive it.
    emitTreeEvent({
      kind: "tree.note_created",
      projectId: b.projectId,
      id: "00000000-0000-0000-0000-000000000002",
      parentId: null,
      label: "b-note",
      at: new Date().toISOString(),
    });

    const events = await collector;
    expect(events).not.toContain("tree.note_created");
    controller.abort();
    try { await res.body?.cancel(); } catch {}
  });

  it("unsubscribes listeners when the client aborts", async () => {
    const seed = await seedWorkspace({ role: "owner" });
    cleanups.push(seed);

    const before = _listenerCountForTest(seed.projectId);
    const { res, controller } = await openStream(
      seed.projectId,
      seed.userId,
    );
    await vi.waitFor(
      () =>
        expect(_listenerCountForTest(seed.projectId)).toBe(before + 1),
      { timeout: 1000 },
    );

    controller.abort();
    try { await res.body?.cancel(); } catch {}

    await vi.waitFor(
      () => expect(_listenerCountForTest(seed.projectId)).toBe(before),
      { timeout: 1000 },
    );
  });
});
