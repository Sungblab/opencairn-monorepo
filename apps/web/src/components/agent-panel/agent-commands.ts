import type { ChatMode } from "./mode-selector";
import type {
  ExternalSearchPolicy,
  MemoryPolicy,
  SourcePolicy,
} from "./context-manifest";

export type AgentCommandId =
  | "summarize"
  | "decompose"
  | "compare"
  | "factcheck"
  | "extract_citations"
  | "make_note"
  | "narrate_note"
  | "generate_report"
  | "generate_deck"
  | "make_table"
  | "quiz"
  | "attach"
  | "web_search"
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
  contextPatch?: {
    sourcePolicy?: SourcePolicy;
    memoryPolicy?: MemoryPolicy;
    externalSearch?: ExternalSearchPolicy;
  };
};

export const AGENT_COMMANDS: AgentCommand[] = [
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
  },
  {
    id: "extract_citations",
    category: "analyze",
    aliases: ["/citations", "/cite", "/인용추출", "/인용"],
    effect: "send",
    promptKey: "extract_citations",
  },
  {
    id: "make_note",
    category: "create",
    aliases: ["/note", "/make-note", "/노트만들기", "/노트"],
    effect: "send",
    promptKey: "make_note",
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
    id: "web_search",
    category: "sources",
    aliases: ["/web", "/web-search", "/웹검색"],
    mode: "research",
    effect: "context",
    promptKey: "web_search",
    contextPatch: { externalSearch: "allowed" },
  },
  {
    id: "paper_search",
    category: "sources",
    aliases: ["/papers", "/paper-search", "/논문검색"],
    mode: "research",
    effect: "send",
    promptKey: "paper_search",
  },
  {
    id: "research",
    category: "sources",
    aliases: ["/research", "/리서치"],
    mode: "research",
    effect: "send",
    promptKey: "research",
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
