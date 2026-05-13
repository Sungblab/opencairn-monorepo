import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  chatMessages,
  chatRunEvents,
  chatRuns,
  chatThreads,
  conversations,
  db,
  desc,
  eq,
  gt,
  isNull,
  lt,
  max,
  notes,
  or,
  sql,
  user as users,
} from "@opencairn/db";
import { billingPlanConfigs } from "@opencairn/shared";
import {
  runAgent as defaultRunAgent,
  createStreamingAgentMessage,
  finalizeAgentMessage,
  resolveAgentMemoryPolicy,
  type AgentChunk,
  type ChatMode,
} from "./agent-pipeline";
import { getTemporalClient, taskQueue } from "./temporal-client";
import { toProjectObjectSummary } from "./project-object-actions";
import { createAgentAction } from "./agent-actions";
import { recordLlmUsageEvent } from "./llm-usage";
import { persistAndPublish } from "./notification-events";
import { chargeManagedCredits, InsufficientCreditsError } from "./billing";
import { envInt } from "./env";

const EXECUTION_LEASE_MS = 60_000;
const EXECUTION_MONITOR_MS = 1_000;
const EVENT_POLL_MIN_MS = 100;
const EVENT_POLL_MAX_MS = 1_000;
const GENERATED_THREAD_TITLE_MAX_LENGTH = 48;

export type RunAgentFn = (opts: {
  threadId: string;
  userId?: string;
  userMessage: { content: string; scope?: unknown };
  mode: ChatMode;
  signal?: AbortSignal;
  excludeMessageIds?: string[];
}) => AsyncGenerator<AgentChunk>;

let runAgentImpl: RunAgentFn = defaultRunAgent;
let startWorkflowImpl = startTemporalChatWorkflow;

export function generateThreadTitleFromMessage(content: string): string {
  const normalized = content
    .replace(/[`*_>#()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (normalized.length <= GENERATED_THREAD_TITLE_MAX_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, GENERATED_THREAD_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

export function setRunAgentForTest(impl: RunAgentFn | null): void {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new Error(
      "setRunAgentForTest may only be called in test environments",
    );
  }
  runAgentImpl = impl ?? defaultRunAgent;
  startWorkflowImpl = impl ? executeChatRun : startTemporalChatWorkflow;
}

export async function createDurableChatRun(input: {
  threadId: string;
  workspaceId: string;
  userId: string;
  content: string;
  scope?: unknown;
  mode: ChatMode;
}): Promise<{
  runId: string;
  workflowId: string;
  userMessageId: string;
  agentMessageId: string;
}> {
  const [userRow] = await db
    .insert(chatMessages)
    .values({
      threadId: input.threadId,
      role: "user",
      status: "complete",
      content: { body: input.content, scope: input.scope },
      mode: input.mode,
    })
    .returning({ id: chatMessages.id });

  const generatedTitle = generateThreadTitleFromMessage(input.content);
  await db
    .update(chatThreads)
    .set({
      updatedAt: sql`now()`,
      ...(generatedTitle
        ? {
            title: sql`case when ${chatThreads.title} = '' then ${generatedTitle} else ${chatThreads.title} end`,
          }
        : {}),
    })
    .where(eq(chatThreads.id, input.threadId));

  const { id: agentMessageId } = await createStreamingAgentMessage(
    input.threadId,
    input.mode,
  );
  const runId = randomUUID();
  const workflowId = `chat-run-${runId}`;

  await db.insert(chatRuns).values({
    id: runId,
    threadId: input.threadId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    userMessageId: userRow.id,
    agentMessageId,
    workflowId,
    status: "queued",
    mode: input.mode,
    scope: input.scope ?? null,
  });

  await appendChatRunEvent(runId, "user_persisted", { id: userRow.id });
  await appendChatRunEvent(runId, "agent_placeholder", { id: agentMessageId });

  return {
    runId,
    workflowId,
    userMessageId: userRow.id,
    agentMessageId,
  };
}

export async function startChatRun(runId: string): Promise<void> {
  await startWorkflowImpl(runId);
}

async function startTemporalChatWorkflow(runId: string): Promise<void> {
  const client = await getTemporalClient();
  await client.workflow.start("ChatAgentWorkflow", {
    taskQueue: taskQueue(),
    workflowId: `chat-run-${runId}`,
    args: [{ run_id: runId }],
  });
}

export async function appendChatRunEvent(
  runId: string,
  event: string,
  payload: unknown,
  executionAttempt?: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({ currentAttempt: chatRuns.currentAttempt })
      .from(chatRuns)
      .where(eq(chatRuns.id, runId))
      .for("update");
    const [current] = await tx
      .select({ seq: max(chatRunEvents.seq) })
      .from(chatRunEvents)
      .where(eq(chatRunEvents.runId, runId));
    const seq = Number(current?.seq ?? 0) + 1;
    await tx.insert(chatRunEvents).values({
      runId,
      seq,
      executionAttempt: executionAttempt ?? run?.currentAttempt ?? 0,
      event,
      payload,
    });
    return seq;
  });
}

export async function listChatRunEvents(runId: string, after: number) {
  return db
    .select({
      id: chatRunEvents.id,
      runId: chatRunEvents.runId,
      seq: chatRunEvents.seq,
      executionAttempt: chatRunEvents.executionAttempt,
      event: chatRunEvents.event,
      payload: chatRunEvents.payload,
      createdAt: chatRunEvents.createdAt,
    })
    .from(chatRunEvents)
    .innerJoin(chatRuns, eq(chatRuns.id, chatRunEvents.runId))
    .where(
      and(
        eq(chatRunEvents.runId, runId),
        gt(chatRunEvents.seq, after),
        or(
          eq(chatRunEvents.executionAttempt, 0),
          eq(chatRunEvents.executionAttempt, chatRuns.currentAttempt),
        ),
      ),
    )
    .orderBy(asc(chatRunEvents.seq));
}

export async function getChatRunForUser(runId: string, userId: string) {
  const [run] = await db
    .select()
    .from(chatRuns)
    .where(and(eq(chatRuns.id, runId), eq(chatRuns.userId, userId)));
  return run ?? null;
}

export async function cancelChatRun(runId: string, userId: string) {
  const run = await getChatRunForUser(runId, userId);
  if (!run) return null;
  if (
    run.status === "complete" ||
    run.status === "failed" ||
    run.status === "cancelled"
  ) {
    return run;
  }
  const now = new Date();
  const [updated] = await db
    .update(chatRuns)
    .set({
      status: "cancelled",
      cancelRequestedAt: now,
      completedAt: now,
      executionLeaseId: null,
      executionLeaseExpiresAt: null,
    })
    .where(eq(chatRuns.id, runId))
    .returning();
  await finalizeAgentMessage(
    run.agentMessageId,
    { body: "", error: { code: "cancelled", message: "cancelled" } },
    "failed",
  );
  await appendChatRunEvent(runId, "error", {
    code: "cancelled",
    message: "cancelled",
  });
  await appendChatRunEvent(runId, "done", {
    id: run.agentMessageId,
    status: "cancelled",
  });
  try {
    const client = await getTemporalClient();
    await client.workflow.getHandle(run.workflowId).cancel();
  } catch {
    // Best-effort: DB state is the user-visible source of truth.
  }
  return updated ?? run;
}

export function streamChatRunEvents(
  runId: string,
  after: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let cursor = after;
      let pollMs = EVENT_POLL_MIN_MS;
      const send = (event: string, payload: unknown, seq: number) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(
            `id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
          ),
        );
      };

      try {
        while (!closed) {
          const events = await listChatRunEvents(runId, cursor);
          for (const event of events) {
            cursor = event.seq;
            pollMs = EVENT_POLL_MIN_MS;
            send(event.event, event.payload, event.seq);
            if (event.event === "done") {
              closed = true;
            }
          }
          if (closed) break;
          await new Promise((resolve) => setTimeout(resolve, pollMs));
          pollMs = Math.min(EVENT_POLL_MAX_MS, pollMs * 2);
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // Browser disconnect means detach, not run cancellation.
    },
  });
}

export async function executeChatRun(runId: string): Promise<void> {
  const lease = await acquireChatRunExecutionLease(runId);
  if (lease.status === "missing")
    throw new Error(`chat run not found: ${runId}`);
  if (lease.status !== "acquired") return;
  const { run, executionAttempt, leaseId } = lease;

  const [userMessage] = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.id, run.userMessageId));
  if (!userMessage) throw new Error(`chat run user message missing: ${runId}`);

  const body = extractBody(userMessage.content);
  const scope = extractScope(userMessage.content);
  const buffer: string[] = [];
  const meta: Record<string, unknown> = {};
  let streamStatus: "complete" | "failed" = "complete";
  let cancelled = false;
  let leaseLost = false;
  const abortController = new AbortController();
  const monitor = startExecutionMonitor(runId, leaseId, abortController);

  try {
    await appendChatRunEvent(
      runId,
      "run_attempt",
      { attempt: executionAttempt },
      executionAttempt,
    );
    for await (const chunk of runAgentImpl({
      threadId: run.threadId,
      userId: run.userId,
      userMessage: { content: body, scope },
      mode: (run.mode ?? "auto") as ChatMode,
      signal: abortController.signal,
      excludeMessageIds: [run.userMessageId, run.agentMessageId],
    })) {
      if (abortController.signal.aborted) {
        const state = await getExecutionState(runId, leaseId);
        cancelled = state === "cancelled";
        leaseLost = state !== "active" && state !== "cancelled";
        break;
      }
      if (chunk.type === "done") break;
      if (chunk.type === "text") {
        const p = chunk.payload as { delta: string };
        buffer.push(p.delta);
      } else if (chunk.type === "status") {
        meta.status = chunk.payload;
      } else if (chunk.type === "thought") {
        meta.thought = chunk.payload;
      } else if (chunk.type === "citation") {
        meta.citations = [
          ...((meta.citations as unknown[]) ?? []),
          chunk.payload,
        ];
      } else if (chunk.type === "save_suggestion") {
        meta.save_suggestion = chunk.payload;
      } else if (chunk.type === "agent_action") {
        await handleAgentActionChunk({
          run,
          scope,
          payload: chunk.payload,
          meta,
        });
      } else if (chunk.type === "agent_file") {
        await handleAgentFileChunk({
          run,
          scope,
          payload: chunk.payload,
          meta,
        });
      } else if (chunk.type === "usage") {
        meta.usage = chunk.payload;
      } else if (chunk.type === "verification") {
        meta.verification = chunk.payload;
      } else if (chunk.type === "error") {
        streamStatus = "failed";
        meta.error = chunk.payload;
      }
      await appendChatRunEvent(
        runId,
        chunk.type,
        chunk.payload,
        executionAttempt,
      );
    }
  } catch (err) {
    streamStatus = "failed";
    meta.error = {
      message: err instanceof Error ? err.message : "agent_failed",
    };
    if (abortController.signal.aborted) {
      const state = await getExecutionState(runId, leaseId);
      cancelled = state === "cancelled";
      leaseLost = state !== "active" && state !== "cancelled";
    }
    if (!cancelled && !leaseLost) {
      await appendChatRunEvent(runId, "error", meta.error, executionAttempt);
    }
  } finally {
    await monitor.stop();
    const latest = await getChatRunById(runId);
    if (leaseLost) {
      return;
    }
    if (cancelled || latest?.status === "cancelled") {
      await finalizeAgentMessage(
        run.agentMessageId,
        {
          body: buffer.join(""),
          ...meta,
          error: meta.error ?? { code: "cancelled", message: "cancelled" },
        },
        "failed",
      );
      await persistChatRunTaskMemory({
        run,
        scope,
        meta,
        terminalStatus: "cancelled",
      });
      await releaseChatRunExecutionLease(runId, leaseId);
      return;
    }

    await finalizeAgentMessage(
      run.agentMessageId,
      { body: buffer.join(""), ...meta },
      streamStatus,
    );
    const terminalStatus = streamStatus === "complete" ? "complete" : "failed";
    const [updated] = await db
      .update(chatRuns)
      .set({
        status: terminalStatus,
        completedAt: new Date(),
        executionLeaseId: null,
        executionLeaseExpiresAt: null,
        error: streamStatus === "failed" ? (meta.error ?? null) : null,
      })
      .where(
        and(
          eq(chatRuns.id, runId),
          eq(chatRuns.executionLeaseId, leaseId),
          eq(chatRuns.status, "running"),
          isNull(chatRuns.cancelRequestedAt),
        ),
      )
      .returning({ id: chatRuns.id });
    if (!updated) {
      await releaseChatRunExecutionLease(runId, leaseId);
      return;
    }
    await persistChatRunTaskMemory({
      run,
      scope,
      meta,
      terminalStatus,
    });
    await compactChatRunThreadMemory({
      run,
      scope,
      terminalStatus,
    });
    await recordChatRunLlmUsage({
      run,
      meta,
      status: streamStatus,
    });
    await publishChatRunCompletionNotification({
      run,
      runId,
      terminalStatus,
    });
    await appendChatRunEvent(
      runId,
      "done",
      {
        id: run.agentMessageId,
        status: terminalStatus,
      },
      executionAttempt,
    );
  }
}

async function persistChatRunTaskMemory(input: {
  run: typeof chatRuns.$inferSelect;
  scope: unknown;
  meta: Record<string, unknown>;
  terminalStatus: "complete" | "failed" | "cancelled";
}) {
  if (resolveAgentMemoryPolicy(input.scope) === "off") return;
  const line = chatRunMemoryLine({
    runId: input.run.id,
    meta: input.meta,
    terminalStatus: input.terminalStatus,
  });
  if (!line) return;

  const projectId = await projectIdFromScope(input.scope);
  const scopeType = projectId ? "project" : "workspace";
  const scopeId = projectId ?? input.run.workspaceId;
  const [conversation] = await db
    .select({
      id: conversations.id,
      sessionMemoryMd: conversations.sessionMemoryMd,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.workspaceId, input.run.workspaceId),
        eq(conversations.ownerUserId, input.run.userId),
        eq(conversations.scopeType, scopeType),
        eq(conversations.scopeId, scopeId),
      ),
    )
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
    .limit(1);

  if (conversation) {
    if (conversation.sessionMemoryMd?.includes(`Chat run ${input.run.id}:`)) {
      return;
    }
    await db
      .update(conversations)
      .set({
        sessionMemoryMd: appendMemoryLine(conversation.sessionMemoryMd, line),
        updatedAt: sql`now()`,
      })
      .where(eq(conversations.id, conversation.id));
    return;
  }

  await db.insert(conversations).values({
    workspaceId: input.run.workspaceId,
    ownerUserId: input.run.userId,
    title: "Agent Panel memory",
    scopeType,
    scopeId,
    attachedChips: [],
    ragMode: "strict",
    sessionMemoryMd: line,
  });
}

function chatRunMemoryLine(input: {
  runId: string;
  meta: Record<string, unknown>;
  terminalStatus: "complete" | "failed" | "cancelled";
}): string | null {
  const facts: string[] = [];
  for (const file of recordArray(input.meta.agent_files)) {
    const title = stringField(file, "title") ?? stringField(file, "filename");
    const filename = stringField(file, "filename");
    if (title && filename) {
      facts.push(`created file ${title} (${filename})`);
    } else if (title) {
      facts.push(`created file ${title}`);
    }
  }
  for (const action of recordArray(input.meta.agent_actions)) {
    const kind = stringField(action, "kind");
    const status = stringField(action, "status");
    if (kind && status) facts.push(`created ${kind} action with ${status} status`);
  }
  if (input.terminalStatus === "failed") {
    facts.push("run failed and can be reviewed from Activity");
  } else if (input.terminalStatus === "cancelled") {
    facts.push("run was cancelled before completion");
  }
  if (facts.length === 0) return null;
  return `- Chat run ${input.runId}: ${facts.join("; ")}.`;
}

function appendMemoryLine(existing: string | null, line: string): string {
  const lines = [...(existing?.split("\n") ?? []), line]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(-80);
  const text = lines.join("\n");
  return text.length <= 4000 ? text : text.slice(text.length - 4000);
}

async function compactChatRunThreadMemory(input: {
  run: typeof chatRuns.$inferSelect;
  scope: unknown;
  terminalStatus: "complete" | "failed";
}) {
  if (input.terminalStatus !== "complete") return;
  if (resolveAgentMemoryPolicy(input.scope) === "off") return;

  const threshold = envInt("CHAT_COMPACTION_MESSAGE_THRESHOLD", 24);
  if (threshold <= 0) return;
  const maxRows = envInt("CHAT_COMPACTION_MAX_MESSAGES", 40);
  const fetchLimit = Math.max(threshold + 1, Math.max(1, maxRows));

  const bodyPresent = sql`length(${chatMessages.content}->>'body') > 0`;
  const rows = await db
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
      id: chatMessages.id,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.threadId, input.run.threadId),
        eq(chatMessages.status, "complete"),
        bodyPresent,
      ),
    )
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(fetchLimit);

  if (rows.length <= threshold) return;
  rows.reverse();

  const projectId = await projectIdFromScope(input.scope);
  const scopeType = projectId ? "project" : "workspace";
  const scopeId = projectId ?? input.run.workspaceId;
  const summary = buildThreadCompactSummary(rows);
  const [conversation] = await db
    .select({
      id: conversations.id,
      fullSummary: conversations.fullSummary,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.workspaceId, input.run.workspaceId),
        eq(conversations.ownerUserId, input.run.userId),
        eq(conversations.scopeType, scopeType),
        eq(conversations.scopeId, scopeId),
      ),
    )
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
    .limit(1);

  const fullSummary = mergeCompactSummary(conversation?.fullSummary ?? null, summary);
  if (conversation) {
    await db
      .update(conversations)
      .set({
        fullSummary,
        updatedAt: sql`now()`,
      })
      .where(eq(conversations.id, conversation.id));
    return;
  }

  await db.insert(conversations).values({
    workspaceId: input.run.workspaceId,
    ownerUserId: input.run.userId,
    title: "Agent Panel memory",
    scopeType,
    scopeId,
    attachedChips: [],
    ragMode: "strict",
    fullSummary,
  });
}

function buildThreadCompactSummary(
  rows: Array<{ role: string; content: unknown }>,
): string {
  const maxRows = envInt("CHAT_COMPACTION_MAX_MESSAGES", 40);
  const selected = rows.slice(-Math.max(1, maxRows));
  const lines = selected
    .map((row) => {
      const label = row.role === "user" ? "User" : "Assistant";
      const body = compactText(jsonBody(row.content), 260);
      return body ? `- ${label}: ${body}` : null;
    })
    .filter((line): line is string => Boolean(line));
  return ["Thread compact summary:", ...lines].join("\n");
}

function mergeCompactSummary(existing: string | null, next: string): string {
  const prefix = existing
    ?.split("\n")
    .filter((line) => !line.startsWith("Thread compact summary:"))
    .join("\n")
    .trim();
  const merged = [prefix, next].filter(Boolean).join("\n\n");
  return compactText(merged, 6000);
}

function jsonBody(content: unknown): string {
  if (
    content !== null &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    "body" in content
  ) {
    const body = (content as { body: unknown }).body;
    return typeof body === "string" ? body : "";
  }
  return "";
}

function compactText(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength
    ? compact
    : compact.slice(compact.length - maxLength);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

async function publishChatRunCompletionNotification({
  run,
  runId,
  terminalStatus,
}: {
  run: typeof chatRuns.$inferSelect;
  runId: string;
  terminalStatus: "complete" | "failed";
}) {
  if (terminalStatus !== "complete") return;
  try {
    const projectId = await projectIdFromScope(run.scope);
    await persistAndPublish({
      userId: run.userId,
      kind: "system",
      payload: {
        summary: "Agent run completed",
        level: "info",
        refType: "chat_run",
        refId: runId,
        threadId: run.threadId,
        projectId,
      },
    });
  } catch (err) {
    console.warn("chat_run_completion_notification_failed", err);
  }
}

function usageFromMeta(meta: Record<string, unknown>) {
  const usage = meta.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const raw = usage as Record<string, unknown>;
  if (
    typeof raw.tokensIn !== "number" ||
    typeof raw.tokensOut !== "number" ||
    typeof raw.model !== "string"
  ) {
    return null;
  }
  return {
    tokensIn: raw.tokensIn,
    tokensOut: raw.tokensOut,
    model: raw.model,
  };
}

async function recordChatRunLlmUsage(input: {
  run: typeof chatRuns.$inferSelect;
  meta: Record<string, unknown>;
  status: "complete" | "failed";
}) {
  const usage = usageFromMeta(input.meta);
  if (!usage) return;
  try {
    await recordLlmUsageEvent({
      userId: input.run.userId,
      workspaceId: input.run.workspaceId,
      provider: "gemini",
      model: usage.model,
      operation: "chat.stream",
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      sourceType: "chat_run",
      sourceId: input.run.id,
      metadata: {
        status: input.status,
        agentMessageId: input.run.agentMessageId,
      },
    });
    await chargeChatRunManagedCredits({
      run: input.run,
      usage,
      status: input.status,
    });
  } catch (err) {
    console.warn("llm_usage_event_failed", err);
  }
}

async function chargeChatRunManagedCredits(input: {
  run: typeof chatRuns.$inferSelect;
  usage: { tokensIn: number; tokensOut: number; model: string };
  status: "complete" | "failed";
}) {
  const [row] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, input.run.userId))
    .limit(1);
  const plan = row?.plan ?? "free";
  if (!billingPlanConfigs[plan].managedLlm) return;

  try {
    await chargeManagedCredits({
      userId: input.run.userId,
      workspaceId: input.run.workspaceId,
      provider: "gemini",
      model: input.usage.model,
      operation: "chat.stream",
      tokensIn: input.usage.tokensIn,
      tokensOut: input.usage.tokensOut,
      sourceType: "chat_run",
      sourceId: input.run.id,
      requestId: input.run.id,
      idempotencyKey: `chat_run:${input.run.id}:usage`,
      metadata: {
        status: input.status,
        agentMessageId: input.run.agentMessageId,
      },
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      console.warn("chat_run_credit_charge_insufficient", {
        runId: input.run.id,
        requiredCredits: err.requiredCredits,
      });
      return;
    }
    console.warn("chat_run_credit_charge_failed", err);
  }
}

type ChatRunLease =
  | {
      status: "acquired";
      run: typeof chatRuns.$inferSelect;
      executionAttempt: number;
      leaseId: string;
    }
  | { status: "leased" | "missing" | "terminal" };

async function acquireChatRunExecutionLease(
  runId: string,
): Promise<ChatRunLease> {
  const leaseId = randomUUID();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + EXECUTION_LEASE_MS);
  const [existingAttempt] = await db
    .select({ executionAttempt: max(chatRunEvents.executionAttempt) })
    .from(chatRunEvents)
    .where(eq(chatRunEvents.runId, runId));
  const maxEventAttempt = Number(existingAttempt?.executionAttempt ?? 0);
  const [updated] = await db
    .update(chatRuns)
    .set({
      status: "running",
      currentAttempt: sql`greatest(${chatRuns.currentAttempt}, ${maxEventAttempt}) + 1`,
      executionLeaseId: leaseId,
      executionLeaseExpiresAt: leaseExpiresAt,
      startedAt: now,
    })
    .where(
      and(
        eq(chatRuns.id, runId),
        or(
          eq(chatRuns.status, "queued"),
          and(
            eq(chatRuns.status, "running"),
            or(
              isNull(chatRuns.executionLeaseExpiresAt),
              lt(chatRuns.executionLeaseExpiresAt, now),
            ),
          ),
        ),
      ),
    )
    .returning();
  if (updated) {
    return {
      status: "acquired",
      run: updated,
      executionAttempt: updated.currentAttempt,
      leaseId,
    };
  }

  const run = await getChatRunById(runId);
  if (!run) return { status: "missing" };
  if (
    run.status === "complete" ||
    run.status === "failed" ||
    run.status === "cancelled"
  ) {
    return { status: "terminal" };
  }
  return { status: "leased" };
}

async function getChatRunById(runId: string) {
  const [run] = await db.select().from(chatRuns).where(eq(chatRuns.id, runId));
  return run ?? null;
}

type ExecutionState =
  | "active"
  | "cancelled"
  | "terminal"
  | "lease_lost"
  | "missing";

async function getExecutionState(
  runId: string,
  leaseId: string,
): Promise<ExecutionState> {
  const run = await getChatRunById(runId);
  if (!run) return "missing";
  if (run.status === "cancelled" || run.cancelRequestedAt) return "cancelled";
  if (run.status === "complete" || run.status === "failed") return "terminal";
  if (run.executionLeaseId !== leaseId) return "lease_lost";
  return "active";
}

async function releaseChatRunExecutionLease(
  runId: string,
  leaseId: string,
): Promise<void> {
  await db
    .update(chatRuns)
    .set({ executionLeaseId: null, executionLeaseExpiresAt: null })
    .where(and(eq(chatRuns.id, runId), eq(chatRuns.executionLeaseId, leaseId)));
}

function startExecutionMonitor(
  runId: string,
  leaseId: string,
  abortController: AbortController,
): { stop: () => Promise<void> } {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const tick = async () => {
    if (stopped) return;
    const state = await getExecutionState(runId, leaseId);
    if (state === "cancelled" || state !== "active") {
      abortController.abort();
      return;
    }
    await refreshChatRunExecutionLease(runId, leaseId);
  };
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = tick()
      .catch(() => {
        abortController.abort();
      })
      .finally(() => {
        inFlight = null;
      });
  }, EXECUTION_MONITOR_MS);
  inFlight = tick()
    .catch(() => {
      abortController.abort();
    })
    .finally(() => {
      inFlight = null;
    });

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}

async function refreshChatRunExecutionLease(
  runId: string,
  leaseId: string,
): Promise<boolean> {
  const [updated] = await db
    .update(chatRuns)
    .set({
      executionLeaseExpiresAt: new Date(Date.now() + EXECUTION_LEASE_MS),
    })
    .where(
      and(
        eq(chatRuns.id, runId),
        eq(chatRuns.executionLeaseId, leaseId),
        eq(chatRuns.status, "running"),
        isNull(chatRuns.cancelRequestedAt),
      ),
    )
    .returning({ id: chatRuns.id });
  return Boolean(updated);
}

function extractBody(content: unknown): string {
  if (
    content &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    typeof (content as { body?: unknown }).body === "string"
  ) {
    return (content as { body: string }).body;
  }
  return "";
}

function extractScope(content: unknown): unknown {
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return (content as { scope?: unknown }).scope;
  }
  return undefined;
}

async function handleAgentActionChunk(input: {
  run: typeof chatRuns.$inferSelect;
  scope: unknown;
  payload: unknown;
  meta: Record<string, unknown>;
}) {
  const projectId = await projectIdFromScope(input.scope);
  if (!projectId) {
    const error = {
      code: "agent_action_project_required",
      message: "A project scope is required to create agent actions.",
    };
    input.meta.error = error;
    await appendChatRunEvent(input.run.id, "error", error);
    return;
  }

  const approvalMode = actionApprovalModeFromScope(input.scope);
  const payload = input.payload as {
    actions: Array<Parameters<typeof createAgentAction>[2]>;
  };
  const created = [];
  for (const proposed of payload.actions) {
    const { action } = await createAgentAction(projectId, input.run.userId, {
      ...proposed,
      sourceRunId: input.run.id,
      approvalMode,
    });
    created.push(action);
    await appendChatRunEvent(input.run.id, "agent_action_created", { action });
  }

  input.meta.agent_actions = [
    ...((input.meta.agent_actions as unknown[]) ?? []),
    ...created,
  ];
}

async function handleAgentFileChunk(input: {
  run: typeof chatRuns.$inferSelect;
  scope: unknown;
  payload: unknown;
  meta: Record<string, unknown>;
}) {
  const projectId = await projectIdFromScope(input.scope);
  if (!projectId) {
    const error = {
      code: "agent_file_project_required",
      message: "A project scope is required to create files.",
    };
    input.meta.error = error;
    await appendChatRunEvent(input.run.id, "error", error);
    return;
  }

  const payload = input.payload as {
    files: Array<{
      filename: string;
      title?: string;
      kind?: import("@opencairn/shared").AgentFileKind;
      mimeType?: string;
      content?: string;
      base64?: string;
      folderId?: string | null;
      startIngest?: boolean;
    }>;
  };
  const approvalMode = actionApprovalModeFromScope(input.scope);
  const actions = [];
  const created = [];
  for (const file of payload.files) {
    const { action } = await createAgentAction(projectId, input.run.userId, {
      requestId: randomUUID(),
      sourceRunId: input.run.id,
      kind: "file.create",
      risk: "write",
      approvalMode,
      input: file,
    });
    actions.push(action);
    await appendChatRunEvent(input.run.id, "agent_action_created", { action });
    const summary = fileSummaryFromAction(action);
    if (!summary) continue;
    const object = toProjectObjectSummary(summary);
    created.push(summary);
    await appendChatRunEvent(input.run.id, "project_object_created", {
      type: "project_object_created",
      object,
    });
    await appendChatRunEvent(input.run.id, "agent_file_created", {
      type: "agent_file_created",
      file: summary,
    });
  }
  input.meta.agent_actions = [
    ...((input.meta.agent_actions as unknown[]) ?? []),
    ...actions,
  ];
  input.meta.agent_files = [
    ...((input.meta.agent_files as unknown[]) ?? []),
    ...created,
  ];
  input.meta.project_objects = [
    ...((input.meta.project_objects as unknown[]) ?? []),
    ...created.map(toProjectObjectSummary),
  ];
}

function fileSummaryFromAction(
  action: Awaited<ReturnType<typeof createAgentAction>>["action"],
) {
  const result = action.result;
  if (!result || typeof result !== "object" || Array.isArray(result))
    return null;
  const file = (result as { file?: unknown }).file;
  if (!file || typeof file !== "object" || Array.isArray(file)) return null;
  return file as Parameters<typeof toProjectObjectSummary>[0];
}

function actionApprovalModeFromScope(
  scope: unknown,
  fallback: "require" | "auto_safe" = "require",
): "require" | "auto_safe" {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return fallback;
  }
  const manifest = (scope as Record<string, unknown>).manifest;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return fallback;
  }
  const mode = (manifest as Record<string, unknown>).actionApprovalMode;
  if (mode === "auto_safe" || mode === "require") return mode;
  return fallback;
}

async function projectIdFromScope(scope: unknown): Promise<string | null> {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const obj = scope as Record<string, unknown>;
  if (typeof obj.projectId === "string") return obj.projectId;
  const manifest = obj.manifest;
  if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
    const manifestProjectId = (manifest as Record<string, unknown>).projectId;
    if (typeof manifestProjectId === "string") return manifestProjectId;
  }
  if (typeof obj.id === "string" && obj.type === "project") return obj.id;
  const noteId =
    typeof obj.noteId === "string"
      ? obj.noteId
      : typeof obj.id === "string" && obj.type === "page"
        ? obj.id
        : null;
  if (noteId) {
    const [note] = await db
      .select({ projectId: notes.projectId })
      .from(notes)
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)))
      .limit(1);
    return note?.projectId ?? null;
  }
  const chips = Array.isArray(obj.chips) ? obj.chips : [];
  for (const chip of chips) {
    if (
      chip &&
      typeof chip === "object" &&
      !Array.isArray(chip) &&
      (chip as Record<string, unknown>).type === "project" &&
      typeof (chip as Record<string, unknown>).id === "string"
    ) {
      return (chip as Record<string, string>).id;
    }
    if (
      chip &&
      typeof chip === "object" &&
      !Array.isArray(chip) &&
      (chip as Record<string, unknown>).type === "page" &&
      typeof (chip as Record<string, unknown>).id === "string"
    ) {
      const [note] = await db
        .select({ projectId: notes.projectId })
        .from(notes)
        .where(
          and(
            eq(notes.id, (chip as Record<string, string>).id),
            isNull(notes.deletedAt),
          ),
        )
        .limit(1);
      if (note?.projectId) return note.projectId;
    }
  }
  return null;
}
