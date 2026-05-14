import type { ChatMode } from "./mode-selector";
import type {
  ExternalSearchPolicy,
  MemoryPolicy,
  SourcePolicy,
} from "./context-manifest";
import {
  getToolDiscoveryItemsForSurface,
  type ToolDiscoveryContext,
  type ToolDiscoveryItem,
} from "./tool-discovery-catalog";

export type AgentCommandId =
  | "summarize"
  | "decompose"
  | "compare"
  | "factcheck"
  | "extract_citations"
  | "make_note"
  | "concept_wiki"
  | "narrate_note"
  | "generate_report"
  | "generate_figure"
  | "generate_deck"
  | "make_table"
  | "quiz"
  | "attach"
  | "paper_search"
  | "research"
  | "current_document_only"
  | "selected_sources_only"
  | "project_context"
  | "memory_off";

export type AgentCommandCategory = "analyze" | "create" | "sources" | "context";

export type AgentCommand = {
  id: AgentCommandId;
  category: AgentCommandCategory;
  aliases: string[];
  mode?: ChatMode;
  effect: "send" | "context";
  promptKey: AgentCommandId;
  registryItemId?: string;
  registryOutputType?: ToolDiscoveryItem["outputType"];
  registryRisk?: ToolDiscoveryItem["risk"];
  supportedContexts?: ToolDiscoveryContext[];
  contextPatch?: {
    sourcePolicy?: SourcePolicy;
    memoryPolicy?: MemoryPolicy;
    externalSearch?: ExternalSearchPolicy;
  };
};

const BASE_AGENT_COMMANDS: AgentCommand[] = [
  {
    id: "summarize",
    category: "analyze",
    aliases: ["/summarize", "/summary", "/요약"],
    effect: "send",
    promptKey: "summarize",
  },
  {
    id: "decompose",
    category: "analyze",
    aliases: ["/analyze", "/decompose", "/해체분석", "/분석"],
    mode: "accurate",
    effect: "send",
    promptKey: "decompose",
  },
  {
    id: "compare",
    category: "analyze",
    aliases: ["/compare", "/비교"],
    effect: "send",
    promptKey: "compare",
  },
  {
    id: "factcheck",
    category: "analyze",
    aliases: ["/factcheck", "/팩트체크", "/검증"],
    mode: "accurate",
    effect: "send",
    promptKey: "factcheck",
    contextPatch: { sourcePolicy: "auto_project", externalSearch: "allowed" },
  },
  {
    id: "extract_citations",
    category: "analyze",
    aliases: ["/citations", "/cite", "/인용추출", "/인용"],
    mode: "accurate",
    effect: "send",
    promptKey: "extract_citations",
    contextPatch: {
      sourcePolicy: "auto_project",
      memoryPolicy: "auto",
      externalSearch: "allowed",
    },
  },
  {
    id: "make_note",
    category: "create",
    aliases: ["/note", "/make-note", "/노트만들기", "/노트"],
    mode: "accurate",
    effect: "send",
    promptKey: "make_note",
    contextPatch: {
      sourcePolicy: "auto_project",
      memoryPolicy: "auto",
      externalSearch: "allowed",
    },
  },
  {
    id: "concept_wiki",
    category: "create",
    aliases: ["/wiki", "/concept-wiki", "/개념위키", "/위키"],
    mode: "accurate",
    effect: "send",
    promptKey: "concept_wiki",
    contextPatch: {
      sourcePolicy: "auto_project",
      memoryPolicy: "auto",
      externalSearch: "allowed",
    },
  },
  {
    id: "narrate_note",
    category: "create",
    aliases: ["/narrate", "/audio", "/오디오", "/내레이션"],
    mode: "accurate",
    effect: "send",
    promptKey: "narrate_note",
    contextPatch: { sourcePolicy: "current_only" },
  },
  {
    id: "generate_report",
    category: "create",
    aliases: ["/report", "/보고서"],
    mode: "accurate",
    effect: "send",
    promptKey: "generate_report",
  },
  {
    id: "generate_figure",
    category: "create",
    aliases: ["/figure", "/image", "/diagram", "/피규어", "/이미지", "/도식"],
    mode: "balanced",
    effect: "send",
    promptKey: "generate_figure",
    contextPatch: { sourcePolicy: "auto_project" },
  },
  {
    id: "generate_deck",
    category: "create",
    aliases: ["/deck", "/slides", "/발표자료", "/슬라이드"],
    effect: "send",
    promptKey: "generate_deck",
  },
  {
    id: "make_table",
    category: "create",
    aliases: ["/table", "/표만들기", "/표"],
    effect: "send",
    promptKey: "make_table",
  },
  {
    id: "quiz",
    category: "create",
    aliases: ["/quiz", "/퀴즈"],
    effect: "send",
    promptKey: "quiz",
  },
  {
    id: "attach",
    category: "sources",
    aliases: ["/attach", "/첨부"],
    effect: "send",
    promptKey: "attach",
  },
  {
    id: "paper_search",
    category: "sources",
    aliases: ["/papers", "/paper-search", "/논문검색"],
    mode: "research",
    effect: "send",
    promptKey: "paper_search",
    contextPatch: { externalSearch: "allowed" },
  },
  {
    id: "research",
    category: "sources",
    aliases: ["/research", "/리서치"],
    mode: "research",
    effect: "send",
    promptKey: "research",
    contextPatch: { sourcePolicy: "auto_project", externalSearch: "allowed" },
  },
  {
    id: "current_document_only",
    category: "context",
    aliases: ["/current", "/current-doc", "/현재문서만"],
    effect: "context",
    promptKey: "current_document_only",
    contextPatch: { sourcePolicy: "current_only" },
  },
  {
    id: "selected_sources_only",
    category: "context",
    aliases: ["/selected", "/선택자료만"],
    effect: "context",
    promptKey: "selected_sources_only",
    contextPatch: { sourcePolicy: "pinned_only" },
  },
  {
    id: "project_context",
    category: "context",
    aliases: ["/project", "/프로젝트전체"],
    effect: "context",
    promptKey: "project_context",
    contextPatch: { sourcePolicy: "auto_project", memoryPolicy: "auto" },
  },
  {
    id: "memory_off",
    category: "context",
    aliases: ["/memory-off", "/메모리끄기"],
    effect: "context",
    promptKey: "memory_off",
    contextPatch: { memoryPolicy: "off" },
  },
];

const REGISTRY_COMMAND_ID_BY_ITEM_ID: Partial<Record<string, AgentCommandId>> = {
  research: "research",
  summarize: "summarize",
  paper_analysis: "extract_citations",
  pdf_report_fast: "generate_report",
  docx_report: "generate_report",
  pptx_deck: "generate_deck",
  xlsx_table: "make_table",
  source_figure: "generate_figure",
  study_artifact_generator: "quiz",
  data_table: "make_table",
};

function commandMetadataById(): Map<AgentCommandId, ToolDiscoveryItem> {
  const items = getToolDiscoveryItemsForSurface("slash_command");
  const mappedItems = [
    ...items,
    ...getToolDiscoveryItemsForSurface("source_rail"),
    ...getToolDiscoveryItemsForSurface("upload_intent"),
  ];
  const metadata = new Map<AgentCommandId, ToolDiscoveryItem>();
  for (const item of mappedItems) {
    const commandId = REGISTRY_COMMAND_ID_BY_ITEM_ID[item.id];
    if (!commandId) continue;
    const existing = metadata.get(commandId);
    if (!existing) {
      metadata.set(commandId, item);
      continue;
    }
    metadata.set(commandId, {
      ...existing,
      aliases: [...(existing.aliases ?? []), ...(item.aliases ?? [])].filter(
        (alias, index, aliases) => aliases.indexOf(alias) === index,
      ),
    });
  }
  return metadata;
}

function enrichCommandsFromRegistry(commands: AgentCommand[]): AgentCommand[] {
  const registry = commandMetadataById();
  return commands.map((command) => {
    const item = registry.get(command.id);
    if (!item) return command;
    return {
      ...command,
      registryItemId: item.id,
      registryOutputType: item.outputType,
      registryRisk: item.risk,
      supportedContexts: item.supportedContexts,
      aliases: [
        ...command.aliases,
        ...(item.aliases ?? []).map((alias) =>
          alias.startsWith("/") ? alias : `/${alias}`,
        ),
      ].filter((alias, index, aliases) => aliases.indexOf(alias) === index),
    };
  });
}

export const AGENT_COMMANDS: AgentCommand[] =
  enrichCommandsFromRegistry(BASE_AGENT_COMMANDS);

function normalizeCommandText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function filterSlashCommands(rawQuery: string): AgentCommand[] {
  const query = normalizeCommandText(rawQuery);
  if (!query) return AGENT_COMMANDS.slice(0, 8);
  const normalized = query.startsWith("/") ? query : `/${query}`;
  return AGENT_COMMANDS.filter((command) =>
    command.aliases.some((alias) =>
      normalizeCommandText(alias).includes(normalized),
    ),
  );
}

export function parseSlashCommand(input: string):
  | {
      command: AgentCommand;
      content: string;
    }
  | null {
  const trimmed = input.trim();
  if (!trimmed.normalize("NFKC").startsWith("/")) return null;
  const [token = "", ...rest] = trimmed.split(/\s+/);
  const normalized = normalizeCommandText(token);
  const command = AGENT_COMMANDS.find((item) =>
    item.aliases.some((alias) => normalizeCommandText(alias) === normalized),
  );
  if (!command) return null;
  return { command, content: rest.join(" ").trim() };
}

export function getAgentCommand(id: AgentCommandId | undefined): AgentCommand | null {
  if (!id) return null;
  return AGENT_COMMANDS.find((command) => command.id === id) ?? null;
}

export function getAgentCommandsForContexts(
  contexts: ToolDiscoveryContext[],
  limit = 6,
): AgentCommand[] {
  const contextSet = new Set(contexts);
  return AGENT_COMMANDS.filter((command) => {
    if (!command.supportedContexts?.length) return false;
    return command.supportedContexts.some((context) => contextSet.has(context));
  }).slice(0, limit);
}
