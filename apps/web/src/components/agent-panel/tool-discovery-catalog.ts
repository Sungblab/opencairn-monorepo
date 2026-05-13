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

export type ToolDiscoverySurface = "project_home" | "agent_tools";

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
  i18nKey: string;
  icon: ToolDiscoveryIcon;
  emphasis?: boolean;
  requiresProject?: boolean;
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
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "import",
    icon: "download",
    action: { type: "upload" },
  },
  {
    id: "literature",
    category: "add_sources",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "literature",
    icon: "book",
    action: { type: "literature_search" },
  },
  {
    id: "web_import",
    category: "add_sources",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "webImport",
    icon: "link",
    action: { type: "route", route: "workspace_import_web" },
  },
  {
    id: "youtube_import",
    category: "add_sources",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "youtubeImport",
    icon: "video",
    action: { type: "route", route: "workspace_import_youtube" },
  },
  {
    id: "connected_sources",
    category: "add_sources",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "connectedSources",
    icon: "plug",
    action: { type: "route", route: "workspace_integrations" },
  },
  {
    id: "research",
    category: "analysis",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "research",
    icon: "search",
    preflight: { tool: "deep_research", sourceTokenEstimate: 48_000 },
    action: { type: "deep_research" },
  },
  {
    id: "summarize",
    category: "content",
    surfaces: ["agent_tools"],
    i18nKey: "summarize",
    icon: "sparkles",
    preflight: { tool: "cheat_sheet", sourceTokenEstimate: 18_000 },
    action: { type: "study_artifact_generate", artifactType: "cheat_sheet" },
  },
  {
    id: "pdf_report_fast",
    category: "content",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "pdfReport",
    icon: "file",
    emphasis: true,
    preflight: { tool: "document", sourceTokenEstimate: 24_000 },
    action: {
      type: "document_generation_preset",
      presetId: "pdf_report_fast",
    },
  },
  {
    id: "pdf_report_latex",
    category: "content",
    surfaces: ["project_home", "agent_tools"],
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
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "docxReport",
    icon: "file",
    preflight: { tool: "document", sourceTokenEstimate: 24_000 },
    action: { type: "document_generation_preset", presetId: "docx_report" },
  },
  {
    id: "pptx_deck",
    category: "content",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "slides",
    icon: "presentation",
    preflight: { tool: "slides", sourceTokenEstimate: 24_000 },
    action: { type: "document_generation_preset", presetId: "pptx_deck" },
  },
  {
    id: "xlsx_table",
    category: "content",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "xlsxTable",
    icon: "table",
    preflight: { tool: "data_table", sourceTokenEstimate: 12_000 },
    action: { type: "document_generation_preset", presetId: "xlsx_table" },
  },
  {
    id: "source_figure",
    category: "content",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "sourceFigure",
    icon: "sparkles",
    preflight: { tool: "document", sourceTokenEstimate: 16_000 },
    action: { type: "document_generation_preset", presetId: "source_figure" },
  },
  {
    id: "study_artifact_generator",
    category: "study",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "studyArtifactGenerator",
    icon: "graduation",
    preflight: { tool: "quiz", sourceTokenEstimate: 16_000 },
    action: { type: "study_artifact_generate", artifactType: "quiz_set" },
  },
  {
    id: "flashcards",
    category: "study",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "flashcards",
    icon: "graduation",
    action: { type: "study_artifact_generate", artifactType: "flashcard_deck" },
  },
  {
    id: "teach_to_learn",
    category: "study",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "teachToLearn",
    icon: "brain",
    action: { type: "route", route: "project_learn_socratic" },
  },
  {
    id: "graph",
    category: "analysis",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "graph",
    icon: "network",
    action: { type: "route", route: "project_graph" },
  },
  {
    id: "mind_map",
    category: "analysis",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "mindMap",
    icon: "network",
    action: { type: "route", route: "project_graph_mindmap" },
  },
  {
    id: "data_table",
    category: "utility",
    surfaces: ["agent_tools"],
    i18nKey: "dataTable",
    icon: "table",
    preflight: { tool: "data_table", sourceTokenEstimate: 12_000 },
    action: { type: "study_artifact_generate", artifactType: "data_table" },
  },
  {
    id: "json_export",
    category: "utility",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "jsonExport",
    icon: "file_json",
    preflight: { tool: "data_table", sourceTokenEstimate: 12_000 },
    action: { type: "study_artifact_generate", artifactType: "data_table" },
  },
  {
    id: "agents",
    category: "utility",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "agents",
    icon: "bot",
    action: { type: "route", route: "project_agents" },
  },
  {
    id: "runs",
    category: "utility",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "runs",
    icon: "activity",
    action: { type: "open_activity" },
  },
  {
    id: "review_inbox",
    category: "utility",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "reviewInbox",
    icon: "check",
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
