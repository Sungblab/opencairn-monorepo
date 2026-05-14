import { describe, expect, it } from "vitest";
import {
  materialFamilyForFile,
  recommendedUploadIntentIds,
  uploadIntentToWorkflow,
  type UploadIntentWorkflowCopy,
} from "./upload-intents";

const copy: UploadIntentWorkflowCopy = (key, values = {}) =>
  `${key}:${JSON.stringify(values)}`;

describe("upload intents", () => {
  it("detects source families from MIME type and extension", () => {
    expect(
      materialFamilyForFile(
        new File(["x"], "paper.pdf", { type: "application/pdf" }),
      ),
    ).toBe("paper");
    expect(
      materialFamilyForFile(
        new File(["x"], "dataset.csv", { type: "text/csv" }),
      ),
    ).toBe("table");
    expect(
      materialFamilyForFile(
        new File(["x"], "lecture.webm", { type: "video/webm" }),
      ),
    ).toBe("recording");
  });

  it("recommends format-aware upload follow-ups", () => {
    const ids = recommendedUploadIntentIds([
      new File(["x"], "dataset.csv", { type: "text/csv" }),
    ]);

    expect(ids.has("data_table")).toBe(true);
    expect(ids.has("summary")).toBe(true);
    expect(ids.has("paper_analysis")).toBe(false);
    expect(ids.has("comparison")).toBe(false);
    expect(
      recommendedUploadIntentIds([
        new File(["x"], "a.pdf", { type: "application/pdf" }),
        new File(["x"], "b.pdf", { type: "application/pdf" }),
      ]).has("comparison"),
    ).toBe(true);
  });

  it("maps completed upload intents to existing Agent Panel workflows", () => {
    const workflow = uploadIntentToWorkflow({
      intent: "slides",
      noteId: "note-1",
      fileName: "Research Paper.pdf",
      copy,
    });

    expect(workflow).toMatchObject({
      kind: "document_generation",
      toolId: "pptx_deck",
      presetId: "pptx_deck",
      payload: {
        action: "source_document_generation",
        sourceIds: ["note:note-1"],
      },
    });
  });

  it("maps multi-source comparison to one source-backed document workflow", () => {
    const workflow = uploadIntentToWorkflow({
      intent: "comparison",
      noteId: "note-a",
      sourceNoteIds: ["note-a", "note-b"],
      fileName: "2 uploaded sources",
      copy,
    });

    expect(workflow).toMatchObject({
      kind: "document_generation",
      toolId: "source_comparison",
      presetId: "docx_report",
      payload: {
        action: "source_document_generation",
        sourceIds: ["note:note-a", "note:note-b"],
      },
    });
  });
});
