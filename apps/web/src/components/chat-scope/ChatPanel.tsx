"use client";

import { useRef, useState } from "react";
import type { AttachedChip } from "@opencairn/shared";

import { useScopeContext } from "@/hooks/useScopeContext";

import { ChatInput } from "./ChatInput";
import { CostBadge } from "./CostBadge";
import { PinButton } from "./PinButton";
import type { RagModeValue } from "./RagModeToggle";

type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  costKrw?: number;
};

// Plan 11A — chat panel composition. Lazy-creates the conversation on
// first send so a user who clicks into a page-scoped chat without typing
// anything doesn't pollute the conversations table. Subsequent chip
// add/remove and ragMode patches all flow through the same conversationId.
//
// SSE parsing is inline (no third-party EventSource lib) because we read
// the full body once — the placeholder reply is short enough that we
// don't need streaming render. Real LLM streaming arrives in Plan 11B
// alongside the chip humanizer/router specs already on disk.
export function ChatPanel() {
  const ctx = useScopeContext();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chips, setChips] = useState<AttachedChip[]>(ctx.initialChips);
  const [ragMode, setRagMode] = useState<RagModeValue>("strict");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  // Concurrent calls (e.g. user types and clicks a chip in the same
  // tick) used to spawn duplicate POST /conversations requests because
  // both saw `conversationId === null`. The ref captures the in-flight
  // promise so subsequent callers await the same response.
  const pendingCreate = useRef<Promise<string | null> | null>(null);

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

  async function send(text: string): Promise<void> {
    setBusy(true);
    try {
      const cid = await ensureConversation();
      if (!cid) return;
      setMessages((m) => [...m, { role: "user", content: text }]);
      const res = await fetch("/api/chat/message", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify({ conversationId: cid, content: text }),
      });
      const raw = await res.text();
      const assistant: Message = { role: "assistant", content: "" };
      let messageId: string | undefined;
      let costKrw = 0;
      // SSE blocks separated by blank lines; each block carries a
      // single `event:` and `data:` line in our placeholder pipeline.
      for (const block of raw.split("\n\n")) {
        const eventLine = block.match(/^event: (\w+)/m)?.[1];
        const dataLine = block.match(/^data: (.+)$/m)?.[1];
        if (!eventLine || !dataLine) continue;
        const data = JSON.parse(dataLine) as Record<string, unknown>;
        if (eventLine === "delta") assistant.content += String(data.delta ?? "");
        if (eventLine === "cost") {
          messageId = data.messageId as string | undefined;
          costKrw = Number(data.costKrw ?? 0);
        }
      }
      assistant.id = messageId;
      assistant.costKrw = costKrw;
      setMessages((m) => [...m, assistant]);
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
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "text-stone-900" : "text-stone-700"}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
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
          </div>
        ))}
      </div>
      <div className="border-t border-stone-200 p-2">
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
