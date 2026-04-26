import { describe, it, expect, vi } from "vitest";
import { defaultPayloadConverter, type Payload } from "@temporalio/client";
import { streamBuildView } from "../../src/lib/temporal-visualize.js";

// ─── Plan 5 KG Phase 2 · Task 10 · streamBuildView SSE wrapper ──────────
//
// Pure unit test — no DB, no real Temporal server. The fake handle mirrors
// the SDK shape we depend on:
//   - describe() → WorkflowExecutionDescription with `raw.pendingActivities`,
//     each `heartbeatDetails` is an `IPayloads` (`{payloads: Payload[]}`)
//     where each `Payload` is bytes-encoded heartbeat detail. We use
//     `defaultPayloadConverter.toPayload` so the wire-shape exactly matches
//     what the real Temporal server returns.
//   - result()  → ViewSpec dict on success, throws on failure
//   - cancel()  → best-effort, called from ReadableStream.cancel()
//
// Heartbeats from the worker side are emitted by HeartbeatLoopHooks (see
// apps/worker/src/worker/agents/visualization/heartbeat_hooks.py) which
// accumulates `{event, payload}` records and calls
// `activity.heartbeat(*self._events)` so the latest heartbeat carries the
// full event history. Plan 5 Phase 2 follow-up after the post-merge code
// review (gemini-code-assist) — the original fake assumed `heartbeatDetails`
// was a plain JS array, which never matched production.

type ToolEvent = { event: string; payload: unknown };

function encodeEvents(events: ToolEvent[]): Payload[] {
  // Mirrors `activity.heartbeat(*events)` — each event becomes one Payload
  // entry on the resulting `IPayloads.payloads` array. The latest heartbeat
  // overwrites the previous; supplying the entire history each time is how
  // the worker side prevents lossy fast-tool windows.
  return events.map((e) => defaultPayloadConverter.toPayload(e));
}

describe("streamBuildView", () => {
  function makeFakeHandle(opts: {
    /** Per-poll snapshots — each item is the cumulative event history at
     * that poll. The fake encodes them via the real DefaultPayloadConverter
     * so the production decode path is exercised end-to-end. */
    pollSnapshots: ToolEvent[][];
    result: unknown | { error: string };
  }) {
    let pollCount = 0;
    return {
      async fetchHistory() {
        return { events: [] };
      },
      async describe() {
        const idx = pollCount++;
        const events =
          opts.pollSnapshots[Math.min(idx, opts.pollSnapshots.length - 1)] ?? [];
        return {
          raw: {
            pendingActivities: [
              { heartbeatDetails: { payloads: encodeEvents(events) } },
            ],
          },
        };
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
    const events: ToolEvent[] = [
      { event: "tool_use", payload: { name: "search_concepts", callId: "1" } },
      {
        event: "tool_result",
        payload: { callId: "1", name: "search_concepts", ok: true },
      },
    ];
    const handle = makeFakeHandle({
      // Worker accumulates: poll 1 sees only tool_use, poll 2 sees both.
      pollSnapshots: [[events[0]], [events[0], events[1]]],
      result: {
        viewType: "graph",
        layout: "fcose",
        rootId: null,
        nodes: [],
        edges: [],
      },
    });
    const out: string[] = [];
    const stream = streamBuildView(handle as never);
    const reader = stream.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out.push(dec.decode(value));
    }
    const body = out.join("");
    expect(body).toContain("event: tool_use");
    expect(body).toContain("event: tool_result");
    expect(body).toContain("event: view_spec");
    expect(body).toContain("event: done");
    const idxToolUse = body.indexOf("event: tool_use");
    const idxToolResult = body.indexOf("event: tool_result");
    const idxViewSpec = body.indexOf("event: view_spec");
    const idxDone = body.indexOf("event: done");
    expect(idxToolUse).toBeLessThan(idxToolResult);
    expect(idxToolResult).toBeLessThan(idxViewSpec);
    expect(idxViewSpec).toBeLessThan(idxDone);
  });

  it("dedupes events when the worker re-sends the same accumulated history", async () => {
    // The worker sends the full history on every heartbeat; the same event
    // appears in many consecutive snapshots. The wrapper must emit each
    // event exactly once.
    const evt: ToolEvent = {
      event: "tool_use",
      payload: { name: "search_concepts", callId: "1" },
    };
    const handle = makeFakeHandle({
      pollSnapshots: [[evt], [evt], [evt]],
      result: {
        viewType: "graph",
        layout: "fcose",
        rootId: null,
        nodes: [],
        edges: [],
      },
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
    const matches = body.match(/event: tool_use/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("emits error + done when result throws", async () => {
    const handle = makeFakeHandle({
      pollSnapshots: [[]],
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
    expect(body.indexOf("event: error")).toBeLessThan(
      body.indexOf("event: done"),
    );
  });

  it("calls handle.cancel when reader is canceled", async () => {
    const handle = makeFakeHandle({
      pollSnapshots: [
        [{ event: "tool_use", payload: { name: "search_concepts", callId: "1" } }],
      ],
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
