import { describe, it, expect } from "vitest";
import { parseSseChunk } from "./api-client-doc-editor";

describe("parseSseChunk", () => {
  it("yields a doc_editor_result event from a well-formed chunk", () => {
    const chunk =
      "event: doc_editor_result\n" +
      `data: ${JSON.stringify({
        output_mode: "diff",
        payload: {
          hunks: [
            {
              blockId: "b1",
              originalRange: { start: 0, end: 5 },
              originalText: "hello",
              replacementText: "Hello",
            },
          ],
          summary: "tightened",
        },
      })}\n\n`;
    const events = parseSseChunk(chunk);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("doc_editor_result");
  });

  it("ignores malformed events without throwing", () => {
    const chunk = "event: doc_editor_result\ndata: {not json\n\n";
    expect(parseSseChunk(chunk)).toEqual([]);
  });

  it("yields multiple events from a single chunk", () => {
    const chunk =
      "event: cost\n" +
      `data: ${JSON.stringify({ tokens_in: 100, tokens_out: 50, cost_krw: 0 })}\n\n` +
      "event: done\n" +
      "data: {}\n\n";
    const events = parseSseChunk(chunk);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("cost");
    expect(events[1].type).toBe("done");
  });

  it("rejects events that fail zod validation", () => {
    // negative tokens_in should be rejected by the schema
    const chunk =
      "event: cost\n" +
      `data: ${JSON.stringify({ tokens_in: -1, tokens_out: 0, cost_krw: 0 })}\n\n`;
    expect(parseSseChunk(chunk)).toEqual([]);
  });
});
