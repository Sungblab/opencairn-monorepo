import type {
  DocumentGenerationFormat,
  ImageRenderEngine,
  PdfRenderEngine,
  StudioToolProfileId,
} from "@/lib/api-client";
import type { StudyArtifactType } from "@opencairn/shared";
import type { AgentCommandId } from "./agent-commands";

export type ToolDiscoveryCategory =
  | "add_sources"
  | "study"
  | "content"
  | "analysis"
  | "utility";

export type ToolDiscoverySurface =
  | "project_home"
  | "agent_tools"
  | "sidebar_command_rail"
  | "file_explorer"
  | "source_rail"
  | "slash_command"
  | "upload_intent"
  | "workflow_console";

export type ToolDiscoveryContext =
  | "project"
  | "source"
  | "selection"
  | "project_object"
  | "artifact"
  | "workflow_run"
  | "upload_batch";

export type ToolDiscoveryOutputType =
  | "note"
  | "agent_file"
  | "workflow"
  | "study_artifact"
  | "navigation"
  | "conversation";

export type ToolDiscoveryRisk = "low" | "medium" | "approval_required";

export type DocumentGenerationTemplate =
  | "report"
  | "brief"
  | "research_summary"
  | "technical_report"
  | "research_brief"
  | "paper_style"
  | "business_report"
  | "deck"
  | "spreadsheet"
  | "custom";

export type DocumentGenerationPresetId =
  | "pdf_report_fast"
  | "pdf_report_latex"
  | "docx_report"
  | "pptx_deck"
  | "xlsx_table"
  | "source_figure";

export type DocumentGenerationPreset = {
  id: DocumentGenerationPresetId;
  format: DocumentGenerationFormat;
  renderEngine?: PdfRenderEngine;
  imageEngine?: ImageRenderEngine;
  template: DocumentGenerationTemplate;
  promptKey: string;
  filenameBaseKey: string;
};

export type ToolDiscoveryIcon =
  | "activity"
  | "book"
  | "bot"
  | "brain"
  | "check"
  | "download"
  | "file"
  | "file_json"
  | "graduation"
  | "link"
  | "mic"
  | "network"
  | "plug"
  | "presentation"
  | "search"
  | "sparkles"
  | "table"
  | "video";

export type ToolDiscoveryAction =
  | {
      type: "route";
      route:
        | "project_graph"
        | "project_graph_mindmap"
        | "project_agents"
        | "project_learn"
        | "project_learn_flashcards"
        | "project_learn_socratic"
        | "workspace_integrations"
        | "workspace_import_web"
        | "workspace_import_youtube";
    }
  | { type: "upload" }
  | { type: "open_activity" }
  | { type: "open_review" }
  | { type: "literature_search" }
  | { type: "deep_research" }
  | { type: "workbench_command"; commandId: AgentCommandId }
  | { type: "study_artifact_generate"; artifactType: StudyArtifactType }
  | {
      type: "document_generation_preset";
      presetId: DocumentGenerationPresetId;
    };

export type ToolDiscoveryItem = {
  id: string;
  category: ToolDiscoveryCategory;
  surfaces: ToolDiscoverySurface[];
  supportedContexts: ToolDiscoveryContext[];
  requiredInputs?: ToolDiscoveryContext[];
  outputType: ToolDiscoveryOutputType;
  risk: ToolDiscoveryRisk;
  aliases?: string[];
  recommendedContentTypes?: string[];
  i18nKey: string;
  icon: ToolDiscoveryIcon;
  emphasis?: boolean;
  requiresProject?: boolean;
  sidebarSection?: "workflow" | "review";
  preflight?: {
    tool: StudioToolProfileId;
    sourceTokenEstimate: number;
  };
  action: ToolDiscoveryAction;
};

export const TOOL_DISCOVERY_CATEGORY_ORDER: ToolDiscoveryCategory[] = [
  "add_sources",
  "study",
  "content",
  "analysis",
  "utility",
];

export const DOCUMENT_GENERATION_PRESETS: Record<
  DocumentGenerationPresetId,
  DocumentGenerationPreset
> = {
  pdf_report_fast: {
    id: "pdf_report_fast",
    format: "pdf",
    renderEngine: "pymupdf",
    template: "technical_report",
    promptKey: "pdfReportFast",
    filenameBaseKey: "pdfReportFast",
  },
  pdf_report_latex: {
    id: "pdf_report_latex",
    format: "pdf",
    renderEngine: "latex",
    template: "paper_style",
    promptKey: "pdfReportLatex",
    filenameBaseKey: "pdfReportLatex",
  },
  docx_report: {
    id: "docx_report",
    format: "docx",
    template: "report",
    promptKey: "docxReport",
    filenameBaseKey: "docxReport",
  },
  pptx_deck: {
    id: "pptx_deck",
    format: "pptx",
    template: "deck",
    promptKey: "pptxDeck",
    filenameBaseKey: "pptxDeck",
  },
  xlsx_table: {
    id: "xlsx_table",
    format: "xlsx",
    template: "spreadsheet",
    promptKey: "xlsxTable",
    filenameBaseKey: "xlsxTable",
  },
  source_figure: {
    id: "source_figure",
    format: "image",
    imageEngine: "svg",
    template: "research_brief",
    promptKey: "sourceFigure",
    filenameBaseKey: "sourceFigure",
  },
};

export const TOOL_DISCOVERY_ITEMS: ToolDiscoveryItem[] = [
  {
    id: "import",
    category: "add_sources",
    surfaces: [
      "project_home",
      "agent_tools",
      "sidebar_command_rail",
      "upload_intent",
    ],
    supportedContexts: ["project", "upload_batch"],
    outputType: "workflow",
    risk: "low",
    aliases: ["upload", "source intake", "add file"],
    i18nKey: "import",
    icon: "download",
    action: { type: "upload" },
  },
  {
    id: "literature",
    category: "add_sources",
    surfaces: ["project_home", "agent_tools", "sidebar_command_rail"],
    supportedContexts: ["project"],
    outputType: "workflow",
    risk: "medium",
    aliases: ["paper search", "literature import"],
    i18nKey: "literature",
    icon: "book",
    sidebarSection: "workflow",
    action: { type: "literature_search" },
  },
  {
    id: "web_import",
    category: "add_sources",
    surfaces: ["project_home", "agent_tools", "sidebar_command_rail"],
    supportedContexts: ["project"],
    outputType: "workflow",
    risk: "low",
    aliases: ["web", "url"],
    i18nKey: "webImport",
    icon: "link",
    action: { type: "route", route: "workspace_import_web" },
  },
  {
    id: "recording",
    category: "add_sources",
    surfaces: [
      "project_home",
      "agent_tools",
      "sidebar_command_rail",
      "upload_intent",
    ],
    supportedContexts: ["project", "upload_batch"],
    outputType: "workflow",
    risk: "low",
    aliases: ["recording", "audio", "video", "lecture", "meeting"],
    recommendedContentTypes: ["audio/*", "video/*"],
    i18nKey: "recording",
    icon: "mic",
    action: { type: "upload" },
  },
  {
    id: "youtube_import",
    category: "add_sources",
    surfaces: ["project_home", "agent_tools", "sidebar_command_rail"],
    supportedContexts: ["project"],
    outputType: "workflow",
    risk: "low",
    aliases: ["video", "youtube"],
    i18nKey: "youtubeImport",
    icon: "video",
    action: { type: "route", route: "workspace_import_youtube" },
  },
  {
    id: "connected_sources",
    category: "add_sources",
    surfaces: ["project_home", "agent_tools", "sidebar_command_rail"],
    supportedContexts: ["project"],
    outputType: "navigation",
    risk: "low",
    aliases: ["drive", "notion", "integration"],
    i18nKey: "connectedSources",
    icon: "plug",
    action: { type: "route", route: "workspace_integrations" },
  },
  {
    id: "research",
    category: "analysis",
    surfaces: [
      "project_home",
      "agent_tools",
      "sidebar_command_rail",
      "source_rail",
    ],
    supportedContexts: ["project", "source"],
    outputType: "workflow",
    risk: "medium",
    aliases: ["deep research", "research"],
    i18nKey: "research",
    icon: "search",
    sidebarSection: "workflow",
    preflight: { tool: "deep_research", sourceTokenEstimate: 48_000 },
    action: { type: "deep_research" },
  },
  {
    id: "summarize",
    category: "content",
    surfaces: ["agent_tools", "source_rail", "upload_intent", "slash_command"],
    supportedContexts: ["project", "source", "selection", "upload_batch"],
    outputType: "study_artifact",
    risk: "medium",
    aliases: ["summary", "cheat sheet"],
    i18nKey: "summarize",
    icon: "sparkles",
    preflight: { tool: "cheat_sheet", sourceTokenEstimate: 18_000 },
    action: { type: "study_artifact_generate", artifactType: "cheat_sheet" },
  },
  {
    id: "paper_analysis",
    category: "content",
    surfaces: [
      "file_explorer",
      "source_rail",
      "upload_intent",
      "slash_command",
    ],
    supportedContexts: ["source", "upload_batch"],
    requiredInputs: ["source"],
    outputType: "agent_file",
    risk: "medium",
    aliases: ["paper", "source analysis", "citation report"],
    recommendedContentTypes: ["application/pdf"],
    i18nKey: "paperAnalysis",
    icon: "file",
    emphasis: true,
    preflight: { tool: "document", sourceTokenEstimate: 24_000 },
    action: {
      type: "document_generation_preset",
      presetId: "pdf_report_fast",
    },
  },
  {
    id: "pdf_report_fast",
    category: "content",
    surfaces: [
      "project_home",
      "agent_tools",
      "sidebar_command_rail",
      "file_explorer",
      "source_rail",
      "upload_intent",
      "slash_command",
    ],
    supportedContexts: ["project", "source", "upload_batch"],
    outputType: "agent_file",
    risk: "medium",
    aliases: ["pdf", "report", "summary"],
    recommendedContentTypes: ["application/pdf", "text/*"],
    i18nKey: "pdfReport",
    icon: "file",
    emphasis: true,
    sidebarSection: "workflow",
    preflight: { tool: "document", sourceTokenEstimate: 24_000 },
    action: {
      type: "document_generation_preset",
      presetId: "pdf_report_fast",
    },
  },
  {
    id: "pdf_report_latex",
    category: "content",
    surfaces: ["project_home", "agent_tools", "file_explorer", "source_rail"],
    supportedContexts: ["project", "source"],
    outputType: "agent_file",
    risk: "medium",
    aliases: ["latex", "paper report"],
    i18nKey: "latexPdf",
    icon: "file",
    preflight: { tool: "document", sourceTokenEstimate: 32_000 },
    action: {
      type: "document_generation_preset",
      presetId: "pdf_report_latex",
    },
  },
  {
    id: "docx_report",
    category: "content",
    surfaces: [
      "project_home",
      "agent_tools",
      "sidebar_command_rail",
      "upload_intent",
      "slash_command",
    ],
    supportedContexts: ["project", "source", "upload_batch"],
    outputType: "agent_file",
    risk: "medium",
    aliases: ["docx", "document", "report"],
    i18nKey: "docxReport",
    icon: "file",
    sidebarSection: "workflow",
    preflight: { tool: "document", sourceTokenEstimate: 24_000 },
    action: { type: "document_generation_preset", presetId: "docx_report" },
  },
  {
    id: "pptx_deck",
    category: "content",
    surfaces: [
      "project_home",
      "agent_tools",
      "sidebar_command_rail",
      "upload_intent",
      "slash_command",
    ],
    supportedContexts: ["project", "source", "upload_batch"],
    outputType: "agent_file",
    risk: "medium",
    aliases: ["slides", "deck", "presentation"],
    i18nKey: "slides",
    icon: "presentation",
    sidebarSection: "workflow",
    preflight: { tool: "slides", sourceTokenEstimate: 24_000 },
    action: { type: "document_generation_preset", presetId: "pptx_deck" },
  },
  {
    id: "xlsx_table",
    category: "content",
    surfaces: [
      "project_home",
      "agent_tools",
      "sidebar_command_rail",
      "upload_intent",
      "slash_command",
    ],
    supportedContexts: ["project", "source", "upload_batch"],
    outputType: "agent_file",
    risk: "medium",
    aliases: ["table", "spreadsheet", "xlsx"],
    i18nKey: "xlsxTable",
    icon: "table",
    sidebarSection: "workflow",
    preflight: { tool: "data_table", sourceTokenEstimate: 12_000 },
    action: { type: "document_generation_preset", presetId: "xlsx_table" },
  },
  {
    id: "source_figure",
    category: "content",
    surfaces: [
      "project_home",
      "agent_tools",
      "sidebar_command_rail",
      "source_rail",
      "upload_intent",
      "slash_command",
    ],
    supportedContexts: ["project", "source", "selection", "upload_batch"],
    outputType: "agent_file",
    risk: "medium",
    aliases: ["figure", "diagram", "image"],
    i18nKey: "sourceFigure",
    icon: "sparkles",
    sidebarSection: "workflow",
    preflight: { tool: "document", sourceTokenEstimate: 16_000 },
    action: { type: "document_generation_preset", presetId: "source_figure" },
  },
  {
    id: "study_artifact_generator",
    category: "study",
    surfaces: [
      "project_home",
      "agent_tools",
      "sidebar_command_rail",
      "source_rail",
      "upload_intent",
      "slash_command",
    ],
    supportedContexts: ["project", "source", "upload_batch"],
    outputType: "study_artifact",
    risk: "medium",
    aliases: ["quiz", "study material"],
    i18nKey: "studyArtifactGenerator",
    icon: "graduation",
    sidebarSection: "workflow",
    preflight: { tool: "quiz", sourceTokenEstimate: 16_000 },
    action: { type: "study_artifact_generate", artifactType: "quiz_set" },
  },
  {
    id: "flashcards",
    category: "study",
    surfaces: ["project_home", "agent_tools", "source_rail"],
    supportedContexts: ["project", "source", "upload_batch"],
    outputType: "study_artifact",
    risk: "medium",
    aliases: ["flashcard", "cards"],
    i18nKey: "flashcards",
    icon: "graduation",
    action: { type: "study_artifact_generate", artifactType: "flashcard_deck" },
  },
  {
    id: "teach_to_learn",
    category: "study",
    surfaces: ["project_home", "agent_tools", "source_rail"],
    supportedContexts: ["project", "source"],
    outputType: "workflow",
    risk: "low",
    aliases: ["socratic", "tutor"],
    i18nKey: "teachToLearn",
    icon: "brain",
    action: { type: "route", route: "project_learn_socratic" },
  },
  {
    id: "graph",
    category: "analysis",
    surfaces: ["project_home", "agent_tools", "sidebar_command_rail"],
    supportedContexts: ["project"],
    outputType: "navigation",
    risk: "low",
    aliases: ["knowledge graph", "map"],
    i18nKey: "graph",
    icon: "network",
    sidebarSection: "workflow",
    action: { type: "route", route: "project_graph" },
  },
  {
    id: "mind_map",
    category: "analysis",
    surfaces: ["project_home", "agent_tools", "sidebar_command_rail"],
    supportedContexts: ["project"],
    outputType: "navigation",
    risk: "low",
    aliases: ["mindmap", "map"],
    i18nKey: "mindMap",
    icon: "network",
    sidebarSection: "workflow",
    action: { type: "route", route: "project_graph_mindmap" },
  },
  {
    id: "data_table",
    category: "utility",
    surfaces: ["agent_tools", "upload_intent", "slash_command"],
    supportedContexts: ["project", "source", "upload_batch"],
    outputType: "study_artifact",
    risk: "medium",
    aliases: ["data", "table"],
    i18nKey: "dataTable",
    icon: "table",
    preflight: { tool: "data_table", sourceTokenEstimate: 12_000 },
    action: { type: "study_artifact_generate", artifactType: "data_table" },
  },
  {
    id: "json_export",
    category: "utility",
    surfaces: ["project_home", "agent_tools", "sidebar_command_rail"],
    supportedContexts: ["project", "source"],
    outputType: "study_artifact",
    risk: "medium",
    aliases: ["json", "export"],
    i18nKey: "jsonExport",
    icon: "file_json",
    preflight: { tool: "data_table", sourceTokenEstimate: 12_000 },
    action: { type: "study_artifact_generate", artifactType: "data_table" },
  },
  {
    id: "agents",
    category: "utility",
    surfaces: ["project_home", "agent_tools", "sidebar_command_rail"],
    supportedContexts: ["project"],
    outputType: "navigation",
    risk: "low",
    aliases: ["workflow console", "agent runs"],
    i18nKey: "agents",
    icon: "bot",
    action: { type: "route", route: "project_agents" },
  },
  {
    id: "runs",
    category: "utility",
    surfaces: [
      "project_home",
      "agent_tools",
      "sidebar_command_rail",
      "workflow_console",
    ],
    supportedContexts: ["project", "workflow_run"],
    outputType: "workflow",
    risk: "low",
    aliases: ["activity", "runs"],
    i18nKey: "runs",
    icon: "activity",
    sidebarSection: "review",
    action: { type: "open_activity" },
  },
  {
    id: "review_inbox",
    category: "utility",
    surfaces: [
      "project_home",
      "agent_tools",
      "sidebar_command_rail",
      "workflow_console",
    ],
    supportedContexts: ["project", "workflow_run", "artifact"],
    outputType: "workflow",
    risk: "approval_required",
    aliases: ["approval", "review"],
    i18nKey: "reviewInbox",
    icon: "check",
    sidebarSection: "review",
    action: { type: "open_review" },
  },
];

export function getDocumentGenerationPreset(
  id: DocumentGenerationPresetId,
): DocumentGenerationPreset {
  return DOCUMENT_GENERATION_PRESETS[id];
}

export function getToolDiscoveryGroups(surface: ToolDiscoverySurface): Array<{
  category: ToolDiscoveryCategory;
  items: ToolDiscoveryItem[];
}> {
  return TOOL_DISCOVERY_CATEGORY_ORDER.map((category) => ({
    category,
    items: TOOL_DISCOVERY_ITEMS.filter(
      (item) => item.category === category && item.surfaces.includes(surface),
    ),
  })).filter((group) => group.items.length > 0);
}

export function getToolDiscoveryItemsForSurface(
  surface: ToolDiscoverySurface,
  options: {
    contexts?: ToolDiscoveryContext[];
    contentType?: string | null;
    limit?: number;
  } = {},
): ToolDiscoveryItem[] {
  const contexts = options.contexts ?? [];
  const contentType = options.contentType?.toLowerCase() ?? null;
  const items = TOOL_DISCOVERY_ITEMS.filter((item) => {
    if (!item.surfaces.includes(surface)) return false;
    if (
      contexts.length > 0 &&
      !contexts.some((context) => item.supportedContexts.includes(context))
    ) {
      return false;
    }
    if (!contentType || !item.recommendedContentTypes?.length) return true;
    return item.recommendedContentTypes.some((candidate) =>
      candidate.endsWith("/*")
        ? contentType.startsWith(candidate.slice(0, -1))
        : contentType === candidate,
    );
  });
  return typeof options.limit === "number"
    ? items.slice(0, options.limit)
    : items;
}
