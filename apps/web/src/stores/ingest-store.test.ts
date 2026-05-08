import { describe, it, expect, beforeEach } from "vitest";
import { useIngestStore } from "./ingest-store";
import type { IngestEvent } from "@opencairn/shared";

function reset() {
  useIngestStore.setState({ runs: {}, spotlightWfid: null });
}

describe("ingest-store", () => {
  beforeEach(reset);

  it("startRun creates a run with running status and seeds spotlight", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    const state = useIngestStore.getState();
    expect(state.runs["wf-1"].status).toBe("running");
    expect(state.runs["wf-1"].fileName).toBe("x.pdf");
    expect(state.spotlightWfid).toBe("wf-1");
  });

  it("startRun can prime a source bundle before the SSE status event arrives", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf", {
      sourceBundleNodeId: "00000000-0000-0000-0000-000000000010",
    });
    const run = useIngestStore.getState().runs["wf-1"];
    expect(run.bundleNodeId).toBe("00000000-0000-0000-0000-000000000010");
    expect(run.bundleStatus).toBe("running");
  });

  it("multi-file dispatch within 200ms keeps the original spotlight", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "a.pdf");
    useIngestStore.getState().startRun("wf-2", "application/pdf", "b.pdf");
    expect(useIngestStore.getState().spotlightWfid).toBe("wf-1");
  });

  it("applyEvent updates units on unit_parsed", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    const ev: IngestEvent = {
      workflowId: "wf-1",
      seq: 1,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "unit_parsed",
      payload: { index: 2, unitKind: "page", charCount: 100, durationMs: 50 },
    };
    useIngestStore.getState().applyEvent("wf-1", ev);
    expect(useIngestStore.getState().runs["wf-1"].units.current).toBe(3);
  });

  it("ignores events with seq <= lastSeq (idempotent)", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    const ev: IngestEvent = {
      workflowId: "wf-1",
      seq: 5,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "figure_extracted",
      payload: {
        sourceUnit: 0,
        objectKey: "k",
        figureKind: "image",
        caption: null,
        width: 100,
        height: 100,
      },
    };
    useIngestStore.getState().applyEvent("wf-1", ev);
    useIngestStore.getState().applyEvent("wf-1", ev); // duplicate
    expect(useIngestStore.getState().runs["wf-1"].figures).toHaveLength(1);
  });

  it("completed sets status and noteId", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1",
      seq: 99,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "completed",
      payload: {
        noteId: "00000000-0000-0000-0000-000000000001",
        totalDurationMs: 5000,
      },
    });
    const run = useIngestStore.getState().runs["wf-1"];
    expect(run.status).toBe("completed");
    expect(run.noteId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("failed sets error info", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1",
      seq: 1,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "failed",
      payload: { reason: "boom", quarantineKey: null, retryable: false },
    });
    const run = useIngestStore.getState().runs["wf-1"];
    expect(run.status).toBe("failed");
    expect(run.error?.reason).toBe("boom");
    expect(run.error?.retryable).toBe(false);
  });

  it("dismissDockCard removes the run", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    useIngestStore.getState().dismissDockCard("wf-1");
    expect(useIngestStore.getState().runs["wf-1"]).toBeUndefined();
  });

  it("stage_changed updates current stage", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1",
      seq: 2,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "stage_changed",
      payload: { stage: "enhancing", pct: null },
    });
    expect(useIngestStore.getState().runs["wf-1"].stage).toBe("enhancing");
  });
});
