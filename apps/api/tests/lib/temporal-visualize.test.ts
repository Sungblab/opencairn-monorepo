import { describe, it, expect, vi } from "vitest";
import { streamBuildView } from "../../src/lib/temporal-visualize.js";

// ─── Plan 5 KG Phase 2 · Task 10 · streamBuildView SSE wrapper ──────────
//
// Pure unit test — no DB, no real Temporal client. The fake handle mirrors
// the polling shape we depend on:
//   - describe()    → { pendingActivities: [{ heartbeatDetails: [...] }] }
//   - result()      → ViewSpec dict on success, throws on failure
//   - cancel()      → best-effort, called from ReadableStream.cancel()
//
// Heartbeats from the worker side are emitted by HeartbeatLoopHooks (see
// apps/worker/src/worker/agents/visualization/heartbeat_hooks.py) as
// `{event, payload}` records. Phase C of Deep Research uses a DB-projection
// SSE; this wrapper instead forwards Temporal heartbeats directly because
// build_view has no equivalent persisted run row.

describe("streamBuildView", () => {
  function makeFakeHandle(opts: {
    heartbeats: Array<{ event: string; payload: unknown }>;
    result: unknown | { error: string };
  }) {
    let pollCount = 0;
    return {
      async fetchHistory() {
        return { events: [] };
      },
      async describe() {
        const idx = pollCount++;
        return idx < opts.heartbeats.length
          ? { pendingActivities: [{ heartbeatDetails: [opts.heartbeats[idx]] }] }
          : { pendingActivities: [] };
      },
      async result() {
        if (
          opts.result &&
          typeof opts.result === "object" &&
          "error" in opts.result
        ) {
          throw new Error((opts.result as { error: string }).error);
        }
        return opts.result;
      },
      async cancel() {
        return;
      },
    };
  }

  it("emits tool_use, tool_result, view_spec, done in order", async () => {
    const heartbeats = [
      { event: "tool_use", payload: { name: "search_concepts", callId: "1" } },
      { event: "tool_result", payload: { callId: "1", name: "search_concepts", ok: true } },
    ];
    const handle = makeFakeHandle({
      heartbeats,
      result: {
        viewType: "graph",
        layout: "fcose",
        rootId: null,
        nodes: [],
        edges: [],
      },
    });
    const events: string[] = [];
    const stream = streamBuildView(handle as never);
    const reader = stream.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      events.push(dec.decode(value));
    }
    const body = events.join("");
    expect(body).toContain("event: tool_use");
    expect(body).toContain("event: tool_result");
    expect(body).toContain("event: view_spec");
    expect(body).toContain("event: done");
    // Ordering: tool_use < tool_result < view_spec < done
    const idxToolUse = body.indexOf("event: tool_use");
    const idxToolResult = body.indexOf("event: tool_result");
    const idxViewSpec = body.indexOf("event: view_spec");
    const idxDone = body.indexOf("event: done");
    expect(idxToolUse).toBeLessThan(idxToolResult);
    expect(idxToolResult).toBeLessThan(idxViewSpec);
    expect(idxViewSpec).toBeLessThan(idxDone);
  });

  it("emits error + done when result throws", async () => {
    const handle = makeFakeHandle({
      heartbeats: [],
      result: { error: "agent_did_not_emit_view_spec" },
    });
    const stream = streamBuildView(handle as never);
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let body = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      body += dec.decode(value);
    }
    expect(body).toContain("event: error");
    expect(body).toContain("agent_did_not_emit_view_spec");
    expect(body).toContain("event: done");
    // error must precede done
    expect(body.indexOf("event: error")).toBeLessThan(body.indexOf("event: done"));
  });

  it("calls handle.cancel when reader is canceled", async () => {
    const heartbeats = [
      { event: "tool_use", payload: { name: "search_concepts", callId: "1" } },
    ];
    const handle = makeFakeHandle({
      heartbeats,
      result: {
        viewType: "graph",
        layout: "fcose",
        rootId: null,
        nodes: [],
        edges: [],
      },
    });
    const cancelSpy = vi.spyOn(handle, "cancel");
    const stream = streamBuildView(handle as never);
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelSpy).toHaveBeenCalled();
  });
});
