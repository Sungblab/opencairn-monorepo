import { describe, it, expect } from "vitest";
import { IngestEvent, IngestEventKind } from "../src/ingest-events.js";

describe("IngestEvent", () => {
  it("validates a started event", () => {
    const ev = {
      workflowId: "ingest-abc",
      seq: 0,
      ts: "2026-04-27T10:00:00.000Z",
      kind: "started" as const,
      payload: {
        mime: "application/pdf",
        fileName: "paper.pdf",
        url: null,
        totalUnits: 30,
      },
    };
    expect(IngestEvent.parse(ev)).toEqual(ev);
  });

  it("rejects unknown kind", () => {
    expect(() =>
      IngestEvent.parse({
        workflowId: "x",
        seq: 0,
        ts: "2026-04-27T10:00:00.000Z",
        kind: "totally_unknown",
        payload: {},
      }),
    ).toThrow();
  });

  it("validates figure_extracted with object key only (no inline image)", () => {
    const ev = IngestEvent.parse({
      workflowId: "x",
      seq: 5,
      ts: "2026-04-27T10:00:00.000Z",
      kind: "figure_extracted",
      payload: {
        sourceUnit: 2,
        objectKey: "uploads/u1/figures/wf1/p2-f0.png",
        figureKind: "image",
        caption: null,
        width: 600,
        height: 400,
      },
    });
    expect(ev.kind).toBe("figure_extracted");
  });

  it("validates enrichment wrapper with arbitrary type", () => {
    const ev = IngestEvent.parse({
      workflowId: "x",
      seq: 10,
      ts: "2026-04-27T10:00:00.000Z",
      kind: "enrichment",
      payload: { type: "b.translation", data: { lang: "ko", chunk: "..." } },
    });
    expect(ev.kind).toBe("enrichment");
  });

  it("accepts document-level parsed units for office and hwp ingest", () => {
    const ev = IngestEvent.parse({
      workflowId: "x",
      seq: 2,
      ts: "2026-04-27T10:00:00.000Z",
      kind: "unit_parsed",
      payload: {
        index: 0,
        unitKind: "document",
        charCount: 3128,
        durationMs: 3900,
      },
    });
    expect(ev.kind).toBe("unit_parsed");
    expect(ev.payload.unitKind).toBe("document");
  });

  it("exposes IngestEventKind enum values", () => {
    const kinds = IngestEventKind.options;
    expect(kinds).toContain("started");
    expect(kinds).toContain("figure_extracted");
    expect(kinds).toContain("enrichment");
  });
});
