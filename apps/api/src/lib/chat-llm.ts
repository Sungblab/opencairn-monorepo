import { and, db, eq, isNull, notes, projects } from "@opencairn/db";
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
    yield { type: "status", payload: { phrase: "관련 문서 훑는 중..." } };

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
        envInt("CHAT_CONTEXT_MAX_TOKENS", 6000),
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
            maxOutputTokens: envInt("CHAT_MAX_OUTPUT_TOKENS", 2048),
            thinkingLevel: policy.thinkingLevel,
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
    const wikiIndexBlock = await buildChatWikiIndexBlock({
      workspaceId: opts.workspaceId,
      scope: opts.scope,
      chips: opts.chips,
      userId: opts.userId,
    });
    const system: ChatMsg = {
      role: "system",
      content: [
        SYSTEM_PROMPT,
        runtimeContext,
        opts.memoryContext,
        wikiIndexBlock,
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
      payload: { summary: "사용자의 질문 분석 중" },
    };

    const buffer: string[] = [];
    let usage: Usage | null = null;
    for await (const chunk of provider.streamGenerate({
      messages,
      signal: opts.signal,
      maxOutputTokens: envInt("CHAT_MAX_OUTPUT_TOKENS", 2048),
      thinkingLevel: policy.thinkingLevel,
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
      yield { type: "agent_action", payload: agentAction };
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
