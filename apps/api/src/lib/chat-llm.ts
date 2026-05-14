import {
  agentFiles,
  and,
  db,
  eq,
  isNull,
  notes,
  projects,
} from "@opencairn/db";
import type { Citation } from "@opencairn/db";
import {
  retrieveWithPolicy,
  type RagMode,
  type RetrievalScope,
  type RetrievalChip,
} from "./chat-retrieval";
import { evidenceBundleToPrompt, packEvidence } from "./context-packer";
import { candidateFromRetrievalHit } from "./retrieval-candidates";
import {
  verifyGroundedAnswer,
  type AnswerVerificationResult,
} from "./answer-verifier";
import { canRead } from "./permissions";
import { buildChatSourceLedger } from "./chat-source-ledger";
import { buildRuntimeContext } from "./chat-runtime-context";
import { selectChatRuntimePolicy, type ChatMode } from "./chat-runtime-policy";
import {
  buildProjectWikiIndex,
  projectWikiIndexToPrompt,
} from "./project-wiki-index";
import { extractSaveSuggestion } from "./save-suggestion-fence";
import { extractAgentFileFence } from "./agent-file-fence";
import { envInt } from "./env";
import { getChatProvider } from "./llm";
import {
  extractAgentActionFence,
  type AgentActionFence,
  type CreateAgentFilePayload,
} from "@opencairn/shared";
import type {
  ChatMsg,
  GroundedSearchSource,
  LLMProvider,
  Usage,
} from "./llm/provider";

export type ChatCitation = Citation & {
  index: number;
  title: string;
  noteId?: string;
  url?: string;
};

export type ChatChunk =
  | { type: "status"; payload: { phrase: string } }
  | { type: "thought"; payload: { summary: string } }
  | { type: "text"; payload: { delta: string } }
  | { type: "citation"; payload: ChatCitation }
  | {
      type: "save_suggestion";
      payload: { title: string; body_markdown: string };
    }
  | { type: "agent_action"; payload: AgentActionFence }
  | { type: "agent_file"; payload: { files: CreateAgentFilePayload[] } }
  | {
      type: "verification";
      payload: AnswerVerificationResult & {
        action: AnswerVerificationResult["verdict"];
      };
    }
  | { type: "usage"; payload: Usage }
  | {
      type: "error";
      payload: { message: string; code?: string; messageKey?: string };
    }
  | { type: "done"; payload: Record<string, never> };

const SYSTEM_PROMPT = [
  "You are OpenCairn, a knowledge assistant grounded in the user's workspace.",
  "When you cite the workspace, use [^N] markers matching the order of the provided context items.",
  "Never invent citations. If the context does not contain the answer, say so plainly.",
  "Reply in the same language as the user's question (Korean if Korean, English if English).",
  "",
  "If the user asks you to create, update, rename, move, delete, restore, or run project work,",
  "prefer typed agent actions instead of saying you completed the change.",
  "For an empty note, use note.create. For a note with generated markdown content, use note.create_from_markdown.",
  "For project files, use file.create, file.update, and file.delete. file.update with content creates a new file version.",
  "Never claim that a project item was created, changed, saved, or deleted unless your final reply includes the corresponding typed fence.",
  "Append exactly one fenced block at the very end of your reply, in this exact form:",
  "",
  "```agent-actions",
  `{"actions":[{"kind":"note.create_from_markdown","risk":"write","input":{"title":"Example","folderId":null,"bodyMarkdown":"# Example\\n..."}},{"kind":"file.create","risk":"write","input":{"filename":"example.md","title":"Example","content":"# Example\\n..."}}]}`,
  "```",
  "",
  "Legacy agent-file fences are still accepted for file creation only, but typed file actions are preferred:",
  "```agent-file",
  `{"files":[{"filename":"example.md","kind":"markdown","mimeType":"text/markdown","content":"# Example\\n..."}]}`,
  "```",
  "",
  "Do not include workspaceId, projectId, userId, actorUserId, or pageId in action inputs.",
  "The server injects trusted scope, applies approval policy, and records the action ledger.",
  "When creating a note from a PDF, current document, lecture material, or uploaded file, create a study note rather than a brief abstract.",
  "The note body should be detailed and structured: title, source/lecture line, numbered sections, subsections, key definitions, examples, tables where useful, and coverage across the whole source.",
  "Avoid one-screen summaries for multi-page materials. Prefer enough detail that the note can replace a first reading pass.",
  "Inside note.create_from_markdown bodyMarkdown, do not include [^N] citation markers or footnote syntax; keep citations in the assistant reply only when needed.",
  "",
  "## Study Note Output Contract",
  "For lecture/PDF/material organization, produce a polished Korean study note instead of a chatty summary.",
  "Use this structure when the source supports it: source line, learning objectives, section-by-section notes, key definitions, examples/code, comparison tables, common mistakes, and review questions.",
  "Use Markdown headings, nested bullets, tables, code fences, and > [!tip]/> [!warn] callouts where they improve readability.",
  "If the user asks for a new note, put the full study note in note.create_from_markdown bodyMarkdown and keep the visible assistant reply short with inline citations.",
  "When the user asks to organize, summarize, or explain lecture/PDF/materials in chat, do not give a shallow outline.",
  "Produce a study-note style answer with the source title, major sections, definitions, examples, code snippets or tables when useful, and review questions when the material contains practice prompts.",
  "For chat answers grounded in workspace context, place [^N] markers next to the sentence or bullet they support. Group citations around meaningful claims instead of repeating the same marker after every sentence.",
  "",
  "Only use save-suggestion when the user asks for a reusable suggestion card rather than asking you to create the note.",
  "If used, append exactly one save-suggestion fenced block at the end:",
  "```save-suggestion",
  `{"title": "<≤80 char title>", "body_markdown": "<markdown body>"}`,
  "```",
].join("\n");

export async function* runChat(opts: {
  userId?: string;
  workspaceId: string;
  scope: RetrievalScope;
  ragMode: RagMode;
  chips: RetrievalChip[];
  rawScope?: unknown;
  history: ChatMsg[];
  userMessage: string;
  signal?: AbortSignal;
  provider?: LLMProvider;
  mode?: ChatMode;
  now?: Date;
  locale?: string;
  timezone?: string;
  memoryContext?: string | null;
}): AsyncGenerator<ChatChunk> {
  const provider = opts.provider ?? getChatProvider();
  const policy = selectChatRuntimePolicy({
    mode: opts.mode ?? "auto",
    userMessage: opts.userMessage,
  });
  const runtimeContext = buildRuntimeContext({
    now: opts.now,
    locale: opts.locale,
    timezone: opts.timezone,
  });

  // try/finally guarantees `done` always fires on natural completion AND
  // when the body throws. The `error` chunk in the catch is the signal
  // for "render failure" before close. Note: when the caller invokes
  // gen.return() to early-close, the finally still runs but the yielded
  // chunks are discarded — standard generator semantics.
  try {
    yield {
      type: "status",
      payload: { phrase: "관련 문서와 현재 자료 확인 중..." },
    };

    const retrieval =
      opts.ragMode === "off"
        ? null
        : await retrieveWithPolicy({
            workspaceId: opts.workspaceId,
            query: opts.userMessage,
            ragMode: opts.ragMode,
            scope: opts.scope,
            chips: opts.chips,
            userId: opts.userId,
            signal: opts.signal,
          });
    const hits = retrieval?.hits ?? [];

    // retrieve() does not check the signal itself; if the user already
    // aborted by the time the embedding+search fanout returns, skip the
    // LLM call so we don't burn tokens.
    if (opts.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }

    // Emit citations up-front. The renderer reconciles [^N] markers in the
    // generated text against this ordered list.
    const candidates = hits.map((hit, index) =>
      candidateFromRetrievalHit(hit, index),
    );
    const evidenceBundle = packEvidence({
      candidates,
      maxTokens:
        retrieval?.policy.contextMaxTokens ??
        envInt("CHAT_CONTEXT_MAX_TOKENS", 12000),
      maxChunksPerNote: retrieval?.policy.maxChunksPerNote,
      maxChunksPerProject: retrieval?.policy.maxChunksPerProject,
    });

    const citations: ChatCitation[] = evidenceBundle.items.map((item) => ({
      source_type: "note",
      source_id: item.noteId,
      snippet: item.snippet,
      index: item.citationIndex,
      title: item.title,
      noteId: item.noteId,
    }));
    for (const c of citations) yield { type: "citation", payload: c };

    if (policy.externalGroundingRequired && citations.length === 0) {
      const grounded = provider.groundSearch
        ? await provider.groundSearch(opts.userMessage, {
            signal: opts.signal,
            maxOutputTokens: policy.maxOutputTokens,
            thinkingLevel: policy.thinkingLevel,
            modelProfile: policy.modelProfile,
          })
        : null;
      if (grounded?.answer && grounded.sources.length > 0) {
        yield {
          type: "thought",
          payload: { summary: "최신 외부 근거 확인 중" },
        };
        for (const c of groundedSourcesToCitations(grounded.sources)) {
          yield { type: "citation", payload: c };
        }
        yield { type: "text", payload: { delta: grounded.answer } };
        if (grounded.usage) yield { type: "usage", payload: grounded.usage };
        return;
      }
      yield {
        type: "error",
        payload: {
          code: "grounding_required",
          messageKey: "chat.errors.groundingRequired",
          message: groundingRequiredMessage(opts.locale),
        },
      };
      return;
    }

    // Build the prompt. RAG context block lives in the system message so it
    // doesn't burn through the user-history truncation budget below.
    const ragBlock = evidenceBundleToPrompt(evidenceBundle);
    const activeDocumentBlock = await buildActiveDocumentContextBlock({
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      scope: opts.scope,
      rawScope: opts.rawScope,
    });
    const wikiIndexBlock = await buildChatWikiIndexBlock({
      workspaceId: opts.workspaceId,
      scope: opts.scope,
      chips: opts.chips,
      userId: opts.userId,
    });
    const workflowIntentBlock = buildWorkflowIntentBlock(opts.rawScope);
    const system: ChatMsg = {
      role: "system",
      content: [
        SYSTEM_PROMPT,
        runtimeContext,
        opts.memoryContext,
        activeDocumentBlock,
        wikiIndexBlock,
        workflowIntentBlock,
        ragBlock,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };

    const history = truncateHistory(opts.history);
    const messages: ChatMsg[] = [
      system,
      ...history,
      { role: "user", content: opts.userMessage },
    ];

    yield {
      type: "thought",
      payload: { summary: "요청과 근거 범위 확인 중" },
    };

    const buffer: string[] = [];
    let usage: Usage | null = null;
    for await (const chunk of provider.streamGenerate({
      messages,
      signal: opts.signal,
      maxOutputTokens: maxOutputTokensForTurn(opts.userMessage, policy),
      thinkingLevel: policy.thinkingLevel,
      modelProfile: policy.modelProfile,
    })) {
      if ("delta" in chunk) {
        buffer.push(chunk.delta);
        yield { type: "text", payload: { delta: chunk.delta } };
      } else if ("usage" in chunk) {
        usage = chunk.usage;
      }
    }

    // Save-suggestion fence is parsed once at the end (system prompt asks
    // for at most one). The fence text was already yielded as part of the
    // text deltas; the renderer strips unrecognized fences itself.
    const full = buffer.join("");
    const verification = verifyRuntimeAnswer({
      answer: full,
      evidenceBundle,
    });
    if (verification) {
      yield { type: "verification", payload: verification };
    }

    const suggestion = extractSaveSuggestion(full);
    if (suggestion) {
      yield { type: "save_suggestion", payload: suggestion };
    }
    const agentFile = extractAgentFileFence(full);
    if (agentFile) {
      yield { type: "agent_file", payload: agentFile };
    }
    const agentAction = extractAgentActionFence(full);
    if (agentAction) {
      yield {
        type: "agent_action",
        payload: sanitizeAgentActionFence(agentAction),
      };
    }
    if (
      requiresExecutableArtifactAction(opts.userMessage) &&
      !suggestion &&
      !agentFile &&
      !agentAction
    ) {
      yield {
        type: "error",
        payload: {
          code: "artifact_action_required",
          messageKey: "chat.errors.artifactActionRequired",
          message: artifactActionRequiredMessage(opts.locale),
        },
      };
      return;
    }

    if (usage) yield { type: "usage", payload: usage };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err instanceof Error && "code" in err
        ? String((err as { code: unknown }).code)
        : undefined;
    yield {
      type: "error",
      payload: { message, ...(code ? { code } : {}) },
    };
  } finally {
    yield { type: "done", payload: {} };
  }
}

function buildWorkflowIntentBlock(rawScope: unknown): string {
  if (!rawScope || typeof rawScope !== "object" || Array.isArray(rawScope)) {
    return "";
  }
  const workflowIntent = (rawScope as Record<string, unknown>).workflowIntent;
  if (
    !workflowIntent ||
    typeof workflowIntent !== "object" ||
    Array.isArray(workflowIntent)
  ) {
    return "";
  }
  return [
    "## Requested Agentic Workflow",
    "The user launched a tool from the agent interface. Treat this JSON as structured intent, not as an already completed action.",
    "Execute the request through the normal assistant response and typed agent-actions fences when a workspace/project mutation is needed.",
    "For literature imports, use import.literature when selected paper IDs are available; otherwise search/explain candidates and ask for confirmation.",
    "For generated study artifacts or documents, create the resulting project file with file.create unless a more specific typed action exists.",
    "Do not copy projectId, workspaceId, or userId into action inputs; trusted scope is injected by the server.",
    "```json",
    JSON.stringify(workflowIntent, null, 2),
    "```",
  ].join("\n");
}

async function buildActiveDocumentContextBlock(opts: {
  workspaceId: string;
  userId?: string;
  scope: RetrievalScope;
  rawScope?: unknown;
}): Promise<string> {
  const noteId = await resolveActiveContextNoteId(opts.rawScope, opts.scope);
  const selectedText = selectedTextFromRawScope(opts.rawScope);
  if (!noteId || !opts.userId) return "";
  try {
    const allowed = await canRead(opts.userId, { type: "note", id: noteId });
    if (!allowed) return "";
    const [note] = await db
      .select({
        id: notes.id,
        title: notes.title,
        workspaceId: notes.workspaceId,
        contentText: notes.contentText,
        sourceType: notes.sourceType,
        mimeType: notes.mimeType,
      })
      .from(notes)
      .where(
        and(
          eq(notes.id, noteId),
          eq(notes.workspaceId, opts.workspaceId),
          isNull(notes.deletedAt),
        ),
      )
      .limit(1);
    const text = note?.contentText?.trim();
    if (!note || !text) return "";
    const maxChars = envInt("CHAT_ACTIVE_DOCUMENT_CONTEXT_CHARS", 120000);
    const excerpt = excerptAcrossDocument(text, maxChars);
    if (selectedText) {
      return [
        "## Current Selection Context",
        `title=${note.title}`,
        `sourceType=${note.sourceType ?? "unknown"} mimeType=${note.mimeType ?? "unknown"}`,
        "The user selected this exact excerpt in the current material. Treat it as the primary and bounded source unless the user explicitly asks for the whole document.",
        "<selected_text>",
        selectedText,
        "</selected_text>",
        "",
        "## Current Document Context",
        "Use the full document only for minimal disambiguation of the selected excerpt.",
        "<current_document_excerpt>",
        excerptAcrossDocument(text, Math.min(maxChars, 8000)),
        "</current_document_excerpt>",
      ].join("\n");
    }
    return [
      "## Current Document Context",
      `title=${note.title}`,
      `sourceType=${note.sourceType ?? "unknown"} mimeType=${note.mimeType ?? "unknown"}`,
      "Use this block as the primary source when the user says this document/PDF/current material.",
      "If creating a note from it, synthesize a useful study note across the document, not a one-screen abstract.",
      "<current_document>",
      excerpt,
      "</current_document>",
    ].join("\n");
  } catch {
    return "";
  }
}

function selectedTextFromRawScope(rawScope: unknown): string | null {
  if (!rawScope || typeof rawScope !== "object" || Array.isArray(rawScope)) {
    return null;
  }
  const invocationContext = (rawScope as Record<string, unknown>).invocationContext;
  if (
    !invocationContext ||
    typeof invocationContext !== "object" ||
    Array.isArray(invocationContext)
  ) {
    return null;
  }
  const selected = (invocationContext as Record<string, unknown>).selectionText;
  return typeof selected === "string" && selected.trim()
    ? selected.trim()
    : null;
}

async function resolveActiveContextNoteId(
  rawScope: unknown,
  scope: RetrievalScope,
): Promise<string | null> {
  if (!rawScope || typeof rawScope !== "object" || Array.isArray(rawScope)) {
    return scope.type === "page" ? scope.noteId : null;
  }
  const rawScopeRecord = rawScope as Record<string, unknown>;
  const noteIdFromAgentFile = async (fileId: string): Promise<string | null> => {
    const [file] = await db
      .select({ sourceNoteId: agentFiles.sourceNoteId })
      .from(agentFiles)
      .where(and(eq(agentFiles.id, fileId), isNull(agentFiles.deletedAt)))
      .limit(1);
    return file?.sourceNoteId ?? null;
  };
  const invocationContext = rawScopeRecord.invocationContext;
  if (
    invocationContext &&
    typeof invocationContext === "object" &&
    !Array.isArray(invocationContext)
  ) {
    const context = invocationContext as Record<string, unknown>;
    if (context.kind === "source" && typeof context.sourceId === "string") {
      return context.sourceId;
    }
    if (context.kind === "note" && typeof context.noteId === "string") {
      return context.noteId;
    }
    if (context.kind === "agent_file" && typeof context.fileId === "string") {
      const noteId = await noteIdFromAgentFile(context.fileId);
      if (noteId) return noteId;
    }
  }
  const manifest = rawScopeRecord.manifest;
  if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
    const activeArtifact = (manifest as Record<string, unknown>).activeArtifact;
    if (
      activeArtifact &&
      typeof activeArtifact === "object" &&
      !Array.isArray(activeArtifact)
    ) {
      const artifact = activeArtifact as Record<string, unknown>;
      if (artifact.type === "note" && typeof artifact.id === "string") {
        return artifact.id;
      }
      if (artifact.type === "file" && typeof artifact.id === "string") {
        const noteId = await noteIdFromAgentFile(artifact.id);
        if (noteId) return noteId;
      }
    }
  }
  return scope.type === "page" ? scope.noteId : null;
}

function maxOutputTokensForTurn(
  userMessage: string,
  policy: ReturnType<typeof selectChatRuntimePolicy>,
): number {
  const fallback = policy.maxOutputTokens;
  if (!requiresExecutableArtifactAction(userMessage)) return fallback;
  return Math.max(fallback, envInt("CHAT_ARTIFACT_MAX_OUTPUT_TOKENS", 20000));
}

function sanitizeAgentActionFence(payload: AgentActionFence): AgentActionFence {
  return {
    actions: payload.actions.map((action) => {
      if (action.kind !== "note.create_from_markdown") return action;
      const input = action.input;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return action;
      }
      const bodyMarkdown = (input as { bodyMarkdown?: unknown }).bodyMarkdown;
      if (typeof bodyMarkdown !== "string") return action;
      return {
        ...action,
        input: {
          ...input,
          bodyMarkdown: stripCitationMarkers(bodyMarkdown),
        },
      };
    }),
  };
}

function stripCitationMarkers(markdown: string): string {
  return markdown
    .replace(/\s*\[\^\d+\](?!:)/g, "")
    .replace(/^\[\^\d+\]:.*(?:\r?\n)?/gm, "")
    .trim();
}

function excerptAcrossDocument(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const sliceSize = Math.max(1, Math.floor(maxChars / 3));
  const head = text.slice(0, sliceSize);
  const middleStart = Math.max(0, Math.floor(text.length / 2 - sliceSize / 2));
  const middle = text.slice(middleStart, middleStart + sliceSize);
  const tail = text.slice(Math.max(0, text.length - sliceSize));
  const omitted = Math.max(
    0,
    text.length - head.length - middle.length - tail.length,
  );
  return [
    head,
    `[현재 자료 중간으로 이동: 일부 원문 생략]`,
    middle,
    `[현재 자료 마지막으로 이동: 일부 원문 생략]`,
    tail,
    `[현재 자료 원문 일부 생략: 약 ${omitted}자]`,
  ].join("\n\n");
}

async function buildChatWikiIndexBlock(opts: {
  workspaceId: string;
  scope: RetrievalScope;
  chips: RetrievalChip[];
  userId?: string;
}): Promise<string> {
  if (!opts.userId) return "";
  try {
    const projectId = await resolveChatWikiIndexProjectId(opts);
    if (!projectId) return "";
    const index = await buildProjectWikiIndex({
      projectId,
      userId: opts.userId,
    });
    if (index.totals.pages === 0) return "";
    return projectWikiIndexToPrompt(index, { pageLimit: 12, orphanLimit: 8 });
  } catch {
    return "";
  }
}

async function resolveChatWikiIndexProjectId(opts: {
  workspaceId: string;
  scope: RetrievalScope;
  chips: RetrievalChip[];
}): Promise<string | null> {
  const projectChips = opts.chips.filter((chip) => chip.type === "project");
  if (projectChips.length === 1) {
    return projectInChatWorkspace(projectChips[0]!.id, opts.workspaceId);
  }
  if (projectChips.length > 1) return null;

  const pageChips = opts.chips.filter((chip) => chip.type === "page");
  if (pageChips.length === 1) {
    return projectIdForChatNote(pageChips[0]!.id, opts.workspaceId);
  }
  if (pageChips.length > 1) return null;

  if (
    opts.scope.type === "project" &&
    opts.scope.workspaceId === opts.workspaceId
  ) {
    return projectInChatWorkspace(opts.scope.projectId, opts.workspaceId);
  }
  if (opts.scope.type === "page") {
    return projectIdForChatNote(opts.scope.noteId, opts.workspaceId);
  }
  return null;
}

async function projectInChatWorkspace(
  projectId: string,
  workspaceId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

async function projectIdForChatNote(
  noteId: string,
  workspaceId: string,
): Promise<string | null> {
  const rows = await db
    .select({ projectId: notes.projectId })
    .from(notes)
    .where(
      and(
        eq(notes.id, noteId),
        eq(notes.workspaceId, workspaceId),
        isNull(notes.deletedAt),
      ),
    )
    .limit(1);
  return rows[0]?.projectId ?? null;
}

function verifyRuntimeAnswer(input: {
  answer: string;
  evidenceBundle: ReturnType<typeof packEvidence>;
}):
  | (AnswerVerificationResult & {
      action: AnswerVerificationResult["verdict"];
    })
  | null {
  if (input.evidenceBundle.items.length === 0) return null;

  const ledger = buildChatSourceLedger(
    input.evidenceBundle.items.map((item) => ({
      noteId: item.noteId,
      projectId: item.projectId,
      noteChunkId: item.chunkId ?? undefined,
      title: item.title,
      headingPath: item.headingPath,
      quote: item.snippet,
      score: item.confidence,
      producer: item.producer.kind,
      evidenceId: item.evidenceId,
      support: item.support,
      provenance: {
        kind: item.provenance,
        evidenceId: item.evidenceId,
        support: item.support,
      },
    })),
  );
  const citedProjectRequirement = minCitedProjectsForBundle(
    input.evidenceBundle,
  );
  const result = verifyGroundedAnswer({
    answer: input.answer,
    ledger,
    minCitedProjects: citedProjectRequirement,
  });

  return {
    ...result,
    action: result.verdict,
  };
}

function minCitedProjectsForBundle(
  evidenceBundle: ReturnType<typeof packEvidence>,
): number | undefined {
  const projects = new Set<string>();
  for (const item of evidenceBundle.items) {
    if (item.projectId) projects.add(item.projectId);
  }
  return projects.size > 1 ? 2 : undefined;
}

// Drop oldest user/assistant turns until the rough character budget for
// history fits under CHAT_MAX_INPUT_TOKENS. Crude but bounded — billing
// uses the provider-reported usage, not this estimate.
function truncateHistory(history: ChatMsg[]): ChatMsg[] {
  const maxTurns = envInt("CHAT_MAX_HISTORY_TURNS", 12);
  const maxTokens = envInt("CHAT_MAX_INPUT_TOKENS", 32000);
  let kept = history.slice(-maxTurns);

  const estimate = (msgs: ChatMsg[]) =>
    Math.ceil(msgs.reduce((n, m) => n + m.content.length, 0) / 3.5);

  while (kept.length > 0 && estimate(kept) > maxTokens) {
    kept = kept.slice(1);
  }
  return kept;
}

function groundingRequiredMessage(locale?: string): string {
  if (locale === "en") {
    return "This question needs current verified sources, but no grounding source is connected. No answer was generated.";
  }
  return "최신 정보가 필요한 질문이라 확인 가능한 근거가 필요합니다. 현재 연결된 검색 근거가 없어 답변을 생성하지 않았습니다.";
}

function artifactActionRequiredMessage(locale?: string): string {
  if (locale === "en") {
    return "The requested creation task was not turned into an executable action. Please try again.";
  }
  return "요청한 생성 작업을 실행 가능한 액션으로 만들지 못했습니다. 다시 시도해 주세요.";
}

function requiresExecutableArtifactAction(userMessage: string): boolean {
  const text = userMessage.toLowerCase();
  const asksForArtifact =
    /(?:노트|문서|파일|pdf|ppt|pptx|docx|csv|html|코드|캔버스|canvas)/i.test(
      text,
    ) ||
    /\b(?:note|document|file|pdf|pptx?|docx|csv|html|code|canvas)\b/i.test(
      text,
    );
  if (!asksForArtifact) return false;

  return /(?:만들어|생성|저장|추가|정리해서\s*새|새\s*노트|노트로|파일로|다운로드|export|create|save|add|generate|make|download)/i.test(
    text,
  );
}

function groundedSourcesToCitations(
  sources: GroundedSearchSource[],
): ChatCitation[] {
  return sources.map((source, index) => ({
    source_type: "external",
    source_id: source.url,
    snippet: source.snippet ?? source.title,
    index: index + 1,
    title: source.title || source.url,
    url: source.url,
  }));
}
