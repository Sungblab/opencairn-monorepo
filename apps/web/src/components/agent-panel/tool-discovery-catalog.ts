import type {
  DocumentGenerationFormat,
  ImageRenderEngine,
  PdfRenderEngine,
} from "@/lib/api-client";
import type { AgentCommandId } from "./agent-commands";

export type ToolDiscoveryCategory =
  | "add_sources"
  | "understand"
  | "create"
  | "study"
  | "organize"
  | "delegate"
  | "review";

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
  | "check"
  | "download"
  | "file"
  | "graduation"
  | "network"
  | "presentation"
  | "search"
  | "sparkles"
  | "table";

export type ToolDiscoveryAction =
  | { type: "route"; route: "project_graph" | "project_agents" | "project_learn" }
  | { type: "upload" }
  | { type: "open_activity" }
  | { type: "open_review" }
  | { type: "literature_search" }
  | { type: "workbench_command"; commandId: AgentCommandId }
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
  action: ToolDiscoveryAction;
};

export const TOOL_DISCOVERY_CATEGORY_ORDER: ToolDiscoveryCategory[] = [
  "add_sources",
  "understand",
  "create",
  "study",
  "organize",
  "delegate",
  "review",
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
    id: "research",
    category: "understand",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "research",
    icon: "search",
    action: { type: "workbench_command", commandId: "research" },
  },
  {
    id: "summarize",
    category: "understand",
    surfaces: ["agent_tools"],
    i18nKey: "summarize",
    icon: "sparkles",
    action: { type: "workbench_command", commandId: "summarize" },
  },
  {
    id: "pdf_report_fast",
    category: "create",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "pdfReport",
    icon: "file",
    emphasis: true,
    action: {
      type: "document_generation_preset",
      presetId: "pdf_report_fast",
    },
  },
  {
    id: "pdf_report_latex",
    category: "create",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "latexPdf",
    icon: "file",
    action: {
      type: "document_generation_preset",
      presetId: "pdf_report_latex",
    },
  },
  {
    id: "docx_report",
    category: "create",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "docxReport",
    icon: "file",
    action: { type: "document_generation_preset", presetId: "docx_report" },
  },
  {
    id: "pptx_deck",
    category: "create",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "pptxDeck",
    icon: "presentation",
    action: { type: "document_generation_preset", presetId: "pptx_deck" },
  },
  {
    id: "xlsx_table",
    category: "create",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "xlsxTable",
    icon: "table",
    action: { type: "document_generation_preset", presetId: "xlsx_table" },
  },
  {
    id: "source_figure",
    category: "create",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "sourceFigure",
    icon: "sparkles",
    action: { type: "document_generation_preset", presetId: "source_figure" },
  },
  {
    id: "learn",
    category: "study",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "learn",
    icon: "graduation",
    action: { type: "route", route: "project_learn" },
  },
  {
    id: "graph",
    category: "organize",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "graph",
    icon: "network",
    action: { type: "route", route: "project_graph" },
  },
  {
    id: "agents",
    category: "delegate",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "agents",
    icon: "bot",
    action: { type: "route", route: "project_agents" },
  },
  {
    id: "runs",
    category: "delegate",
    surfaces: ["project_home", "agent_tools"],
    i18nKey: "runs",
    icon: "activity",
    action: { type: "open_activity" },
  },
  {
    id: "review_inbox",
    category: "review",
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
