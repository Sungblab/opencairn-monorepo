import { describe, expect, it } from "vitest";
import {
  createAgentFilesSchema,
  inferAgentFileKind,
  inferAgentFileMimeType,
} from "../src/agent-files";

describe("agent file shared contracts", () => {
  it("accepts a safe inline text file", () => {
    const parsed = createAgentFilesSchema.parse({
      projectId: "00000000-0000-4000-8000-000000000001",
      files: [
        {
          filename: "paper.tex",
          content: "\\documentclass{article}",
          kind: "latex",
        },
      ],
    });

    expect(parsed.files[0]?.filename).toBe("paper.tex");
  });

  it("rejects traversal filenames", () => {
    expect(() =>
      createAgentFilesSchema.parse({
        projectId: "00000000-0000-4000-8000-000000000001",
        files: [{ filename: "../secret.txt", content: "x" }],
      }),
    ).toThrow();
  });

  it("requires exactly one byte source", () => {
    expect(() =>
      createAgentFilesSchema.parse({
        projectId: "00000000-0000-4000-8000-000000000001",
        files: [{ filename: "a.txt", content: "x", base64: "eA==" }],
      }),
    ).toThrow();
  });

  it("caps chat batch size at five files", () => {
    expect(() =>
      createAgentFilesSchema.parse({
        projectId: "00000000-0000-4000-8000-000000000001",
        files: Array.from({ length: 6 }, (_, index) => ({
          filename: `f-${index}.txt`,
          content: "x",
        })),
      }),
    ).toThrow();
  });

  it("infers viewer kind and MIME from filenames", () => {
    expect(inferAgentFileKind("report.md")).toBe("markdown");
    expect(inferAgentFileKind("analysis.py")).toBe("code");
    expect(inferAgentFileKind("budget.xlsx")).toBe("xlsx");
    expect(inferAgentFileMimeType("budget.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(inferAgentFileMimeType("deck.pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });
});
