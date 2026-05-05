"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createParser } from "eventsource-parser";
import {
  saveSuggestionSchema,
  type AttachedChip,
  type SaveSuggestion,
} from "@opencairn/shared";

import { useTabsStore } from "@/stores/tabs-store";
import { useScopeContext } from "@/hooks/useScopeContext";
import { api } from "@/lib/api-client";
import { newTab } from "@/lib/tab-factory";

import { ChatInput } from "./ChatInput";
import { CostBadge } from "./CostBadge";
import { PinButton } from "./PinButton";
import type { RagModeValue } from "./RagModeToggle";
import {
  AgentFileCards,
  DocumentGenerationCards,
  asAgentFileCards,
  asDocumentGenerationCards,
} from "../agent-panel/message-bubble";
import { SaveSuggestionCard } from "../agent-panel/save-suggestion-card";

type Message = {
  key: string;
  id?: string;
  role: "user" | "assistant";
  content: string;
  costKrw?: number;
  error?: string;
  saveSuggestion?: SaveSuggestion;
  agentFiles?: unknown[];
  projectObjects?: unknown[];
  projectObjectGenerations?: unknown[];
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

// Plan 11A — chat panel composition. Plan 11B swapped the placeholder reply
// for real LLM SSE, so this panel now consumes the response incrementally with
// the same fetch + ReadableStream + eventsource-parser pattern as AgentPanel.
export function ChatPanel() {
  const ctx = useScopeContext();
  const chatErrorT = useTranslations("chat.errors");
  const streamErrorText = chatErrorT("streamFailed");
  const timeoutErrorText = chatErrorT("executionTimeout");
  const saveT = useTranslations("agentPanel.bubble");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chips, setChips] = useState<AttachedChip[]>(ctx.initialChips);
  const [ragMode, setRagMode] = useState<RagModeValue>("strict");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const messageSeq = useRef(0);
  // Concurrent calls (e.g. user types and clicks a chip in the same
  // tick) used to spawn duplicate POST /conversations requests because
  // both saw `conversationId === null`. The ref captures the in-flight
  // promise so subsequent callers await the same response.
  const pendingCreate = useRef<Promise<string | null> | null>(null);
  const activeTabId = useTabsStore((s) => s.activeId);
  const activeTab = useTabsStore((s) =>
    s.tabs.find((tab) => tab.id === activeTabId),
  );

  function nextMessageKey(role: Message["role"]): string {
    messageSeq.current += 1;
    return `${role}-${messageSeq.current}`;
  }

  function updateMessage(
    key: string,
    updater: (message: Message) => Message,
  ): void {
    setMessages((items) =>
      items.map((item) => (item.key === key ? updater(item) : item)),
    );
  }

  function ensureConversation(): Promise<string | null> {
    if (conversationId) return Promise.resolve(conversationId);
    if (!ctx.workspaceId) return Promise.resolve(null);
    if (pendingCreate.current) return pendingCreate.current;

    const promise = (async () => {
      const res = await fetch("/api/chat/conversations", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: ctx.workspaceId,
          scopeType: ctx.scopeType,
          scopeId: ctx.scopeId,
          attachedChips: chips,
          ragMode,
          memoryFlags: {
            l3_global: true,
            l3_workspace: true,
            l4: true,
            l2: false,
          },
        }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        id: string;
        attachedChips: AttachedChip[];
      };
      setConversationId(body.id);
      setChips(body.attachedChips);
      return body.id;
    })().finally(() => {
      pendingCreate.current = null;
    });

    pendingCreate.current = promise;
    return promise;
  }

  const resolveProjectId = useCallback(async (): Promise<string | null> => {
    if (ctx.scopeType === "project") return ctx.scopeId;
    if (activeTab?.kind === "project" && activeTab.targetId) {
      return activeTab.targetId;
    }

    const noteId =
      ctx.scopeType === "page"
        ? ctx.scopeId
        : activeTab?.kind === "note"
          ? activeTab.targetId
          : undefined;
    if (!noteId) return null;

    try {
      const note = await api.getNote(noteId);
      return note.projectId;
    } catch {
      return null;
    }
  }, [activeTab, ctx.scopeId, ctx.scopeType]);

  function getStreamErrorText(payload: unknown): string {
    if (!isObj(payload) || typeof payload.code !== "string") {
      return streamErrorText;
    }
    const code = payload.code.toUpperCase();
    if (
      code === "TIMEOUT" ||
      code === "EXECUTION_TIMEOUT" ||
      code === "LLM_TIMEOUT"
    ) {
      return timeoutErrorText;
    }
    return streamErrorText;
  }

  const handleSaveSuggestion = useCallback(
    async (raw: unknown) => {
      const parsed = saveSuggestionSchema.safeParse(raw);
      if (!parsed.success) {
        toast.error(saveT("save_suggestion_failed"));
        return;
      }
      const { title, body_markdown } = parsed.data;
      const { createNoteFromMarkdown, insertFromMarkdown } = await import(
        "@/lib/notes/insert-from-markdown"
      );

      const apiCreateNote = async (input: {
        title: string;
        content: unknown[];
      }) => {
        const projectId = await resolveProjectId();
        if (!projectId) throw new Error("no project context");
        const note = await api.createNote({
          projectId,
          title: input.title,
          content: input.content,
        });
        return { id: note.id, title: note.title };
      };

      await insertFromMarkdown({
        markdown: body_markdown,
        activeNoteId:
          activeTab?.kind === "note"
            ? (activeTab.targetId ?? undefined)
            : undefined,
        activeNoteIsPlate: activeTab?.kind === "note" && activeTab.mode === "plate",
        apiCreateNote,
        onSuccess: () => toast.success(saveT("save_suggestion_inserted_active")),
        onMissingTarget: () => {
          toast(saveT("save_suggestion_target_prompt"), {
            action: {
              label: saveT("save_suggestion_create_new"),
              onClick: () => {
                void createNoteFromMarkdown({
                  title,
                  markdown: body_markdown,
                  apiCreateNote,
                  onCreated: (note) => {
                    useTabsStore.getState().addTab(
                      newTab({
                        kind: "note",
                        targetId: note.id,
                        title: note.title,
                        mode: "plate",
                      }),
                    );
                  },
                  onError: () => toast.error(saveT("save_suggestion_failed")),
                });
              },
            },
            cancel: { label: saveT("save_suggestion_cancel"), onClick: () => {} },
          });
        },
        onCreatedNote: () => {},
        onError: () => toast.error(saveT("save_suggestion_failed")),
      });
    },
    [activeTab, resolveProjectId, saveT],
  );

  async function send(text: string): Promise<void> {
    setBusy(true);
    try {
      const cid = await ensureConversation();
      if (!cid) return;
      const userKey = nextMessageKey("user");
      const assistantKey = nextMessageKey("assistant");
      setMessages((m) => [
        ...m,
        { key: userKey, role: "user", content: text },
        { key: assistantKey, role: "assistant", content: "" },
      ]);

      const res = await fetch("/api/chat/message", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify({ conversationId: cid, content: text }),
      });

      if (!res.ok || !res.body) {
        updateMessage(assistantKey, (message) => ({
          ...message,
          error: streamErrorText,
        }));
        return;
      }

      const parser = createParser({
        onEvent: (ev) => {
          if (!ev.event) return;
          let payload: unknown = null;
          try {
            payload = ev.data ? JSON.parse(ev.data) : null;
          } catch {
            return;
          }

          switch (ev.event) {
            case "delta":
              if (isObj(payload) && typeof payload.delta === "string") {
                updateMessage(assistantKey, (message) => ({
                  ...message,
                  content: message.content + payload.delta,
                }));
              }
              break;
            case "cost":
              if (isObj(payload)) {
                const costKrw = Number(payload.costKrw ?? 0);
                updateMessage(assistantKey, (message) => ({
                  ...message,
                  id:
                    typeof payload.messageId === "string"
                      ? payload.messageId
                      : message.id,
                  costKrw: Number.isFinite(costKrw) ? costKrw : message.costKrw,
                }));
              }
              break;
            case "save_suggestion": {
              const parsed = saveSuggestionSchema.safeParse(payload);
              if (parsed.success) {
                updateMessage(assistantKey, (message) => ({
                  ...message,
                  saveSuggestion: parsed.data,
                }));
              }
              break;
            }
            case "agent_file_created":
              if (isObj(payload)) {
                updateMessage(assistantKey, (message) => ({
                  ...message,
                  agentFiles: [...(message.agentFiles ?? []), payload.file ?? payload],
                }));
              }
              break;
            case "project_object_created":
              if (isObj(payload)) {
                updateMessage(assistantKey, (message) => ({
                  ...message,
                  projectObjects: [...(message.projectObjects ?? []), payload.object ?? payload],
                }));
              }
              break;
            case "project_object_generation_requested":
            case "project_object_generation_status":
            case "project_object_generation_completed":
            case "project_object_generation_failed":
              if (isObj(payload)) {
                updateMessage(assistantKey, (message) => ({
                  ...message,
                  projectObjectGenerations: [
                    ...(message.projectObjectGenerations ?? []),
                    payload,
                  ],
                }));
              }
              break;
            case "error":
              updateMessage(assistantKey, (message) => ({
                ...message,
                error: getStreamErrorText(payload),
              }));
              break;
            default:
              break;
          }
        },
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
        const tail = decoder.decode();
        if (tail) parser.feed(tail);
      } catch {
        updateMessage(assistantKey, (message) => ({
          ...message,
          error: streamErrorText,
        }));
      }
    } finally {
      setBusy(false);
    }
  }

  async function addChip(c: { type: AttachedChip["type"]; id: string }): Promise<void> {
    const cid = await ensureConversation();
    if (!cid) return;
    const res = await fetch(`/api/chat/conversations/${cid}/chips`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(c),
    });
    if (res.ok) {
      const body = (await res.json()) as { attachedChips: AttachedChip[] };
      setChips(body.attachedChips);
    }
  }

  async function removeChip(key: string): Promise<void> {
    const cid = await ensureConversation();
    if (!cid) return;
    const res = await fetch(
      `/api/chat/conversations/${cid}/chips/${encodeURIComponent(key)}`,
      { method: "DELETE", credentials: "include" },
    );
    if (res.ok) {
      const body = (await res.json()) as { attachedChips: AttachedChip[] };
      setChips(body.attachedChips);
    }
  }

  async function changeRagMode(m: RagModeValue): Promise<void> {
    setRagMode(m);
    if (!conversationId) return; // PATCHed on first creation alongside scope
    await fetch(`/api/chat/conversations/${conversationId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ragMode: m }),
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-auto p-3">
        {messages.map((m) => (
          <div
            key={m.key}
            className={m.role === "user" ? "text-foreground" : "text-muted-foreground"}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.error && (
              <p role="alert" className="mt-1 text-xs text-red-600">
                {m.error}
              </p>
            )}
            {m.role === "assistant" && (
              <div className="mt-1 flex items-center gap-2">
                {m.costKrw !== undefined && <CostBadge costKrw={m.costKrw} />}
                {m.id && ctx.scopeType === "page" && (
                  <PinButton
                    messageId={m.id}
                    targetNoteId={ctx.scopeId}
                    targetBlockId="root"
                  />
                )}
              </div>
            )}
            {m.role === "assistant" && m.saveSuggestion && (
              <SaveSuggestionCard
                title={m.saveSuggestion.title}
                onSave={() => void handleSaveSuggestion(m.saveSuggestion)}
                onDismiss={() =>
                  updateMessage(m.key, (message) => ({
                    ...message,
                    saveSuggestion: undefined,
                  }))
                }
              />
            )}
            {m.role === "assistant" && ((m.agentFiles?.length ?? 0) > 0 || (m.projectObjects?.length ?? 0) > 0) && (
              <AgentFileCards
                files={asAgentFileCards(m.agentFiles, m.projectObjects)}
              />
            )}
            {m.role === "assistant" &&
              (m.projectObjectGenerations?.length ?? 0) > 0 && (
                <DocumentGenerationCards
                  items={asDocumentGenerationCards(m.projectObjectGenerations)}
                />
              )}
          </div>
        ))}
      </div>
      <div className="border-t border-border p-2">
        <ChatInput
          chips={chips}
          workspaceId={ctx.workspaceId}
          ragMode={ragMode}
          onSend={send}
          onAddChip={addChip}
          onRemoveChip={removeChip}
          onChangeRagMode={changeRagMode}
          disabled={busy}
        />
      </div>
    </div>
  );
}
