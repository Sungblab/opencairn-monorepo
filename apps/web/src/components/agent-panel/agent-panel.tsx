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
//   4. The save-suggestion handler (Task 21): validates the SSE payload, tries
//      to insert into the active Plate editor, and falls back to a "create new
//      note" toast action when no Plate editor is open.
// Children (Conversation, Composer, ScopeChipsRow) stay controlled views.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { saveSuggestionSchema } from "@opencairn/shared";

import { useChatSend } from "@/hooks/use-chat-send";
import { useChatThreads } from "@/hooks/use-chat-threads";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { api } from "@/lib/api-client";
import { newTab } from "@/lib/tab-factory";
import {
  createNoteFromMarkdown,
  insertFromMarkdown,
} from "@/lib/notes/insert-from-markdown";
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

  // i18n for save-suggestion toasts (Task 21).
  const t = useTranslations("agentPanel.bubble");

  // Resolves the projectId needed for note creation from the active tab.
  // • note tab → fetch the note row (which includes projectId)
  // • project tab → targetId is the projectId directly
  // • anything else → null (caller handles the missing-target path)
  const resolveProjectId = useCallback(async (): Promise<string | null> => {
    if (!activeTab) return null;
    if (activeTab.kind === "note" && activeTab.targetId) {
      try {
        const note = await api.getNote(activeTab.targetId);
        return note.projectId;
      } catch {
        return null;
      }
    }
    if (activeTab.kind === "project" && activeTab.targetId) {
      return activeTab.targetId;
    }
    return null;
  }, [activeTab]);

  // Validates the SSE payload, inserts markdown into the active Plate editor,
  // and shows a "create new note" toast action when no editor is open.
  const handleSaveSuggestion = useCallback(
    async (raw: unknown) => {
      const parsed = saveSuggestionSchema.safeParse(raw);
      if (!parsed.success) {
        toast.error(t("save_suggestion_failed"));
        return;
      }
      const { title, body_markdown } = parsed.data;

      // Lazily resolve projectId inside apiCreateNote so it is only fetched
      // when the user actually chooses to create a new note.
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
        // activeTab.targetId is the noteId for note tabs.
        activeNoteId:
          activeTab?.kind === "note" ? (activeTab.targetId ?? undefined) : undefined,
        // mode is the TabMode string; "plate" indicates the Plate editor.
        activeNoteIsPlate:
          activeTab?.kind === "note" && activeTab.mode === "plate",
        apiCreateNote,
        onSuccess: () => {
          toast.success(t("save_suggestion_inserted_active"));
        },
        onMissingTarget: () => {
          toast(t("save_suggestion_target_prompt"), {
            action: {
              label: t("save_suggestion_create_new"),
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
                  onError: () => toast.error(t("save_suggestion_failed")),
                });
              },
            },
            cancel: { label: t("save_suggestion_cancel") },
          });
        },
        onCreatedNote: () => {},
        onError: () => toast.error(t("save_suggestion_failed")),
      });
    },
    [activeTab, t, resolveProjectId],
  );

  return (
    <aside
      data-testid="app-shell-agent-panel"
      className="flex h-full flex-col border-l border-border bg-background"
    >
      <PanelHeader onNewThread={startNewThread} />
      {activeThreadId ? (
        <Conversation
          threadId={activeThreadId}
          onSaveSuggestion={handleSaveSuggestion}
        />
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
