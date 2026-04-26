import { describe, it, expect } from "vitest";
import { parseSseChunks } from "../sse-parser";

describe("parseSseChunks", () => {
  it("parses a single complete event from buffer, returns remainder", () => {
    const { events, remainder } = parseSseChunks(
      'event: tool_use\ndata: {"name":"x"}\n\nevent: in',
    );
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("tool_use");
    expect(events[0].data).toEqual({ name: "x" });
    expect(remainder).toBe("event: in");
  });

  it("handles view_spec payload with nested object", () => {
    const { events } = parseSseChunks(
      'event: view_spec\ndata: {"viewSpec":{"viewType":"graph","layout":"fcose","rootId":null,"nodes":[],"edges":[]}}\n\n',
    );
    expect(events[0].event).toBe("view_spec");
    expect((events[0].data as { viewSpec: { viewType: string } }).viewSpec.viewType).toBe(
      "graph",
    );
  });

  it("returns empty events when buffer has no terminator", () => {
    const { events, remainder } = parseSseChunks("event: tool_use\ndata: {}");
    expect(events).toHaveLength(0);
    expect(remainder).toBe("event: tool_use\ndata: {}");
  });

  it("ignores invalid JSON gracefully", () => {
    const { events } = parseSseChunks("event: tool_use\ndata: not-json\n\n");
    expect(events).toHaveLength(0);
  });

  it("parses multiple back-to-back events", () => {
    const { events, remainder } = parseSseChunks(
      'event: tool_use\ndata: {"a":1}\n\nevent: tool_result\ndata: {"a":2}\n\n',
    );
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("tool_use");
    expect(events[1].event).toBe("tool_result");
    expect(remainder).toBe("");
  });
});
