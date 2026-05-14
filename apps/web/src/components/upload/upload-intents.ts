import type {
  AgentWorkflowIntent,
  AgentWorkflowPayload,
} from "@/stores/agent-workbench-store";
import type { StudioToolProfileId } from "@/lib/api-client";

export type UploadIntentId =
  | "none"
  | "paper_analysis"
  | "summary"
  | "figure"
  | "slides"
  | "study"
  | "comparison"
  | "data_table";

export type UploadIntentDefinition = {
  id: UploadIntentId;
  i18nKey: UploadIntentId;
  recommendedFor: Set<UploadMaterialFamily>;
  preflight?: {
    profile: StudioToolProfileId;
    sourceTokenEstimate: number;
  };
};

export type UploadMaterialFamily =
  | "paper"
  | "document"
  | "deck"
  | "table"
  | "image"
  | "recording"
  | "text"
  | "unknown";

type UploadIntentPromptKey =
  | "uploadedSourceFallback"
  | "paperAnalysis.prompt"
  | "paperAnalysis.initialPrompt"
  | "study.prompt"
  | "comparison.prompt"
  | "comparison.initialPrompt"
  | "figure.prompt"
  | "figure.initialPrompt"
  | "slides.prompt"
  | "slides.initialPrompt"
  | "dataTable.prompt"
  | "dataTable.initialPrompt"
  | "summary.prompt"
  | "summary.initialPrompt";

export type UploadIntentWorkflowCopy = (
  key: UploadIntentPromptKey,
  values?: Record<string, string | number>,
) => string;

export const UPLOAD_INTENTS: UploadIntentDefinition[] = [
  {
    id: "none",
    i18nKey: "none",
    recommendedFor: new Set([
      "paper",
      "document",
      "deck",
      "table",
      "image",
      "recording",
      "text",
      "unknown",
    ]),
  },
  {
    id: "paper_analysis",
    i18nKey: "paper_analysis",
    recommendedFor: new Set(["paper", "document"]),
    preflight: { profile: "document", sourceTokenEstimate: 24_000 },
  },
  {
    id: "summary",
    i18nKey: "summary",
    recommendedFor: new Set([
      "paper",
      "document",
      "deck",
      "table",
      "image",
      "recording",
      "text",
      "unknown",
    ]),
    preflight: { profile: "document", sourceTokenEstimate: 18_000 },
  },
  {
    id: "figure",
    i18nKey: "figure",
    recommendedFor: new Set(["paper", "document", "image", "table"]),
    preflight: { profile: "document", sourceTokenEstimate: 16_000 },
  },
  {
    id: "slides",
    i18nKey: "slides",
    recommendedFor: new Set(["paper", "document", "deck", "text"]),
    preflight: { profile: "slides", sourceTokenEstimate: 24_000 },
  },
  {
    id: "study",
    i18nKey: "study",
    recommendedFor: new Set([
      "paper",
      "document",
      "deck",
      "recording",
      "text",
    ]),
    preflight: { profile: "quiz", sourceTokenEstimate: 16_000 },
  },
  {
    id: "comparison",
    i18nKey: "comparison",
    recommendedFor: new Set(["paper", "document", "deck", "table", "text"]),
    preflight: { profile: "document", sourceTokenEstimate: 32_000 },
  },
  {
    id: "data_table",
    i18nKey: "data_table",
    recommendedFor: new Set(["table"]),
    preflight: { profile: "data_table", sourceTokenEstimate: 12_000 },
  },
];

export function uploadIntentDefinition(id: UploadIntentId) {
  return UPLOAD_INTENTS.find((intent) => intent.id === id) ?? UPLOAD_INTENTS[0]!;
}

export function materialFamilyForFile(file: File): UploadMaterialFamily {
  const mime = file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (mime === "application/pdf" || extension === "pdf") return "paper";
  if (
    mime.includes("wordprocessingml") ||
    ["doc", "docx", "hwp", "hwpx"].includes(extension)
  ) {
    return "document";
  }
  if (mime.includes("presentationml") || ["ppt", "pptx"].includes(extension)) {
    return "deck";
  }
  if (
    mime.includes("spreadsheetml") ||
    mime === "text/csv" ||
    ["xls", "xlsx", "csv"].includes(extension)
  ) {
    return "table";
  }
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/") || mime.startsWith("video/")) {
    return "recording";
  }
  if (
    mime.startsWith("text/") ||
    ["txt", "md", "markdown"].includes(extension)
  ) {
    return "text";
  }
  return "unknown";
}

export function recommendedUploadIntentIds(files: File[]): Set<UploadIntentId> {
  const families = new Set(files.map(materialFamilyForFile));
  const ids = new Set(
    UPLOAD_INTENTS.filter((intent) =>
      Array.from(families).some((family) => intent.recommendedFor.has(family)),
    ).map((intent) => intent.id),
  );
  if (files.length < 2) ids.delete("comparison");
  return ids;
}

export function uploadIntentToWorkflow({
  intent,
  noteId,
  sourceNoteIds,
  fileName,
  copy,
}: {
  intent: UploadIntentId;
  noteId: string;
  sourceNoteIds?: string[];
  fileName: string | null;
  copy: UploadIntentWorkflowCopy;
}): Omit<AgentWorkflowIntent, "id"> | null {
  if (intent === "none") return null;
  const sourceTitle = fileName?.trim() || copy("uploadedSourceFallback");
  const resolvedSourceNoteIds =
    sourceNoteIds && sourceNoteIds.length > 0 ? sourceNoteIds : [noteId];
  const sourceIds = resolvedSourceNoteIds.map((id) => `note:${id}`);
  const sourceValues = { sourceTitle };
  if (intent === "paper_analysis") {
    return {
      kind: "document_generation",
      toolId: "paper_analysis",
      i18nKey: "paperAnalysis",
      prompt: copy("paperAnalysis.prompt", sourceValues),
      presetId: "pdf_report_fast",
      payload: {
        action: "source_paper_analysis",
        sourceIds,
        sourceTitle,
        initialPrompt: copy("paperAnalysis.initialPrompt", sourceValues),
        initialFilename: outputFilename(sourceTitle, "paper-analysis", "pdf"),
      },
    };
  }

  if (intent === "study") {
    return {
      kind: "study_artifact",
      toolId: "study_artifact_generator",
      i18nKey: "studyArtifactGenerator",
      prompt: copy("study.prompt", sourceValues),
      artifactType: "quiz_set",
      payload: {
        action: "generate_study_artifact",
        sourceNoteIds: resolvedSourceNoteIds,
        sourceIds,
        sourceTitle,
      },
    };
  }

  if (intent === "comparison") {
    return {
      kind: "document_generation",
      toolId: "source_comparison",
      i18nKey: "comparison",
      prompt: copy("comparison.prompt", {
        count: resolvedSourceNoteIds.length,
      }),
      presetId: "docx_report",
      payload: {
        action: "source_document_generation",
        sourceIds,
        sourceTitle,
        initialPrompt: copy("comparison.initialPrompt", {
          count: resolvedSourceNoteIds.length,
        }),
        initialFilename: outputFilename(sourceTitle, "comparison", "docx"),
      },
    };
  }

  const documentPayload = sourceDocumentGenerationPayload(intent, {
    copy,
    sourceIds,
    sourceTitle,
  });
  return {
    kind: "document_generation",
    toolId: documentPayload.toolId,
    i18nKey: documentPayload.i18nKey,
    prompt: documentPayload.prompt,
    presetId: documentPayload.presetId,
    payload: documentPayload.payload,
  };
}

function sourceDocumentGenerationPayload(
  intent: Exclude<
    UploadIntentId,
    "none" | "paper_analysis" | "study" | "comparison"
  >,
  source: {
    copy: UploadIntentWorkflowCopy;
    sourceIds: string[];
    sourceTitle: string;
  },
): {
  toolId: string;
  i18nKey: string;
  prompt: string;
  presetId: AgentWorkflowIntent["presetId"];
  payload: AgentWorkflowPayload;
} {
  if (intent === "figure") {
    return {
      toolId: "source_figure",
      i18nKey: "sourceFigure",
      prompt: source.copy("figure.prompt", {
        sourceTitle: source.sourceTitle,
      }),
      presetId: "source_figure",
      payload: {
        action: "source_document_generation",
        sourceIds: source.sourceIds,
        sourceTitle: source.sourceTitle,
        initialPrompt: source.copy("figure.initialPrompt", {
          sourceTitle: source.sourceTitle,
        }),
        initialFilename: outputFilename(source.sourceTitle, "figure", "svg"),
      },
    };
  }
  if (intent === "slides") {
    return {
      toolId: "pptx_deck",
      i18nKey: "slides",
      prompt: source.copy("slides.prompt", {
        sourceTitle: source.sourceTitle,
      }),
      presetId: "pptx_deck",
      payload: {
        action: "source_document_generation",
        sourceIds: source.sourceIds,
        sourceTitle: source.sourceTitle,
        initialPrompt: source.copy("slides.initialPrompt", {
          sourceTitle: source.sourceTitle,
        }),
        initialFilename: outputFilename(source.sourceTitle, "slides", "pptx"),
      },
    };
  }
  if (intent === "data_table") {
    return {
      toolId: "xlsx_table",
      i18nKey: "xlsxTable",
      prompt: source.copy("dataTable.prompt", {
        sourceTitle: source.sourceTitle,
      }),
      presetId: "xlsx_table",
      payload: {
        action: "source_document_generation",
        sourceIds: source.sourceIds,
        sourceTitle: source.sourceTitle,
        initialPrompt: source.copy("dataTable.initialPrompt", {
          sourceTitle: source.sourceTitle,
        }),
        initialFilename: outputFilename(source.sourceTitle, "table", "xlsx"),
      },
    };
  }
  return {
    toolId: "summarize",
    i18nKey: "summarize",
    prompt: source.copy("summary.prompt", {
      sourceTitle: source.sourceTitle,
    }),
    presetId: "docx_report",
    payload: {
      action: "source_document_generation",
      sourceIds: source.sourceIds,
      sourceTitle: source.sourceTitle,
      initialPrompt: source.copy("summary.initialPrompt", {
        sourceTitle: source.sourceTitle,
      }),
      initialFilename: outputFilename(source.sourceTitle, "summary", "docx"),
    },
  };
}

function outputFilename(sourceTitle: string, suffix: string, extension: string) {
  const base = sourceTitle
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${base || "uploaded-source"}-${suffix}.${extension}`;
}
