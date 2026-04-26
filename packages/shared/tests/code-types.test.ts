import { describe, it, expect } from "vitest";
import {
  codeAgentRunRequestSchema,
  codeAgentFeedbackSchema,
  codeAgentEventSchema,
  canvasOutputCreateSchema,
  canvasLanguages,
  MAX_CANVAS_OUTPUT_BYTES,
  type CodeAgentEvent,
} from "../src/code-types.js";

const NOTE_ID = "11111111-1111-1111-1111-111111111111";
const RUN_ID = "22222222-2222-2222-2222-222222222222";

describe("codeAgentRunRequestSchema", () => {
  it("accepts valid run request", () => {
    const parsed = codeAgentRunRequestSchema.parse({
      noteId: NOTE_ID,
      prompt: "Plot sin(x)",
      language: "python",
    });
    expect(parsed.language).toBe("python");
  });

  it("rejects prompt > 4000 chars", () => {
    expect(() =>
      codeAgentRunRequestSchema.parse({
        noteId: NOTE_ID,
        prompt: "x".repeat(4001),
        language: "python",
      }),
    ).toThrow();
  });

  it("rejects unknown language", () => {
    expect(() =>
      codeAgentRunRequestSchema.parse({
        noteId: NOTE_ID,
        prompt: "Plot sin(x)",
        language: "ruby",
      }),
    ).toThrow();
  });
});

describe("codeAgentFeedbackSchema", () => {
  it("validates feedback ok / error variants", () => {
    const ok = codeAgentFeedbackSchema.parse({
      runId: RUN_ID,
      kind: "ok",
      stdout: "hello",
    });
    expect(ok.kind).toBe("ok");

    const err = codeAgentFeedbackSchema.parse({
      runId: RUN_ID,
      kind: "error",
      error: "TypeError: x is not a function",
    });
    expect(err.kind).toBe("error");
  });
});

describe("codeAgentEventSchema", () => {
  it("event schema accepts every union case", () => {
    const events: CodeAgentEvent[] = [
      { kind: "queued", runId: RUN_ID },
      { kind: "thought", text: "thinking" },
      { kind: "token", delta: "x" },
      {
        kind: "turn_complete",
        turn: {
          kind: "generate",
          source: "print(1)",
          explanation: null,
          seq: 0,
        },
      },
      { kind: "awaiting_feedback" },
      { kind: "done", status: "completed" },
      { kind: "error", code: "max_turns_exceeded" },
    ];
    for (const event of events) {
      expect(() => codeAgentEventSchema.parse(event)).not.toThrow();
    }
  });
});

describe("canvasOutputCreateSchema", () => {
  it("output create accepts png/svg, rejects jpeg", () => {
    const png = canvasOutputCreateSchema.parse({
      noteId: NOTE_ID,
      mimeType: "image/png",
    });
    expect(png.mimeType).toBe("image/png");

    const svg = canvasOutputCreateSchema.parse({
      noteId: NOTE_ID,
      runId: RUN_ID,
      mimeType: "image/svg+xml",
    });
    expect(svg.mimeType).toBe("image/svg+xml");

    expect(() =>
      canvasOutputCreateSchema.parse({
        noteId: NOTE_ID,
        mimeType: "image/jpeg",
      }),
    ).toThrow();
  });
});

describe("constants", () => {
  it("exports canvas languages and max output bytes", () => {
    expect(canvasLanguages).toEqual(["python", "javascript", "html", "react"]);
    expect(MAX_CANVAS_OUTPUT_BYTES).toBe(2 * 1024 * 1024);
  });
});
