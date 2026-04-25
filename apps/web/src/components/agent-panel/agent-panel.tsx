"use client";

// Top-level assembly for the agent panel. Owns three pieces of cross-cutting
// state that none of the children should know about individually:
//   1. The active workspace id (resolved from the URL slug) — bootstraps the
//      threads-store so its localStorage-backed `activeThreadId` is loaded
//      before any child renders.
//   2. The scope-chips selection + STRICT/LOOSE mode, derived initially from
//      whatever tab the user is currently looking at.
//   3. The "+ new thread" action, shared by the header button and the empty
//      state CTA so both code paths converge on the same mutation.
// Children (Conversation, Composer, ScopeChipsRow) stay controlled views.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { useChatSend } from "@/hooks/use-chat-send";
import { useChatThreads } from "@/hooks/use-chat-threads";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { useTabsStore } from "@/stores/tabs-store";
import { useThreadsStore } from "@/stores/threads-store";

import { Composer } from "./composer";
import { Conversation } from "./conversation";
import { AgentPanelEmptyState } from "./empty-state";
import { PanelHeader } from "./panel-header";
import { ScopeChipsRow, defaultScopeIds } from "./scope-chips-row";

export function AgentPanel() {
  const { wsSlug } = useParams<{ wsSlug?: string }>();
  const workspaceId = useWorkspaceId(wsSlug);

  // setWorkspace bootstraps the active-thread restore from localStorage on
  // every workspace switch — without it the panel would never remember
  // which thread the user was last viewing in this workspace.
  const setWorkspace = useThreadsStore((s) => s.setWorkspace);
  useEffect(() => {
    if (workspaceId) setWorkspace(workspaceId);
  }, [workspaceId, setWorkspace]);

  const activeThreadId = useThreadsStore((s) => s.activeThreadId);
  const setActive = useThreadsStore((s) => s.setActiveThread);
  const { create } = useChatThreads(workspaceId);
  const { send } = useChatSend(activeThreadId);

  // Initial scope selection follows whatever the user is currently looking
  // at: a note tab seeds [page, project], a project view seeds [project], etc.
  const activeTabId = useTabsStore((s) => s.activeId);
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === activeTabId));
  const initialScope = useMemo(
    () => defaultScopeIds(activeTab?.kind),
    [activeTab?.kind],
  );
  const [scope, setScope] = useState<string[]>(initialScope);
  const [strict, setStrict] = useState<"strict" | "loose">("strict");

  // Reset scope when the user switches tabs to a different kind. Only
  // reactive to tab kind so we don't stomp on manual scope edits while the
  // user stays inside the same tab.
  useEffect(() => {
    setScope(defaultScopeIds(activeTab?.kind));
  }, [activeTab?.kind]);

  async function startNewThread() {
    if (!workspaceId) return;
    const { id } = await create.mutateAsync({});
    setActive(id);
  }

  return (
    <aside
      data-testid="app-shell-agent-panel"
      className="flex h-full flex-col border-l border-border bg-background"
    >
      <PanelHeader onNewThread={startNewThread} />
      {activeThreadId ? (
        <Conversation threadId={activeThreadId} />
      ) : (
        <AgentPanelEmptyState onStart={startNewThread} busy={create.isPending} />
      )}
      <ScopeChipsRow
        selected={scope}
        onChange={setScope}
        strict={strict}
        onStrictChange={setStrict}
      />
      <Composer
        disabled={!activeThreadId}
        onSend={(input) =>
          send({
            content: input.content,
            mode: input.mode,
            scope: { chips: scope, strict },
          })
        }
      />
    </aside>
  );
}
