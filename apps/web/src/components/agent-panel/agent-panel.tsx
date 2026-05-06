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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { DocumentGenerationCards, asDocumentGenerationCards } from "./message-bubble";
import { DocumentGenerationForm } from "./document-generation-form";
import { AgentPanelEmptyState } from "./empty-state";
import { NoteUpdateActionReviewList } from "./note-update-action-review";
import { CodeProjectActionReviewList } from "./code-project-action-review";
import { AgenticPlanCard } from "./agentic-plan-card";
import { PanelHeader } from "./panel-header";
import { ScopeChipsRow, defaultScopeIds } from "./scope-chips-row";
import { buildAgentScopePayload } from "./scope-payload";
import { WorkflowConsoleRuns } from "./workflow-console-runs";

export function AgentPanel({ wsSlug }: { wsSlug?: string } = {}) {
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
  const { send, live, resumeRun } = useChatSend(activeThreadId);

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
  const [isSending, setIsSending] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [formGenerationEvents, setFormGenerationEvents] = useState<unknown[]>([]);
  const sendInFlightRef = useRef(false);
  const buildScopePayload = useCallback(
    () =>
      buildAgentScopePayload({
        selectedScopeIds: scope,
        activeTab,
        workspaceId,
        strict,
        resolveNoteProjectId: async (noteId) => {
          try {
            return (await api.getNote(noteId)).projectId;
          } catch {
            return null;
          }
        },
      }),
    [activeTab, scope, strict, workspaceId],
  );

  // Reset scope when the user switches tabs to a different kind. Only
  // reactive to tab kind so we don't stomp on manual scope edits while the
  // user stays inside the same tab.
  useEffect(() => {
    setScope(defaultScopeIds(activeTab?.kind));
  }, [activeTab?.kind]);

  useEffect(() => {
    let cancelled = false;
    async function resolveActiveProject() {
      if (!activeTab) {
        if (!cancelled) setActiveProjectId(null);
        return;
      }
      if (activeTab.kind === "project" && activeTab.targetId) {
        if (!cancelled) setActiveProjectId(activeTab.targetId);
        return;
      }
      if (activeTab.kind === "note" && activeTab.targetId) {
        try {
          const note = await api.getNote(activeTab.targetId);
          if (!cancelled) setActiveProjectId(note.projectId);
        } catch {
          if (!cancelled) setActiveProjectId(null);
        }
        return;
      }
      if (!cancelled) setActiveProjectId(null);
    }
    void resolveActiveProject();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  async function startNewThread() {
    if (!workspaceId) return;
    const { id } = await create.mutateAsync({});
    setActive(id);
  }
  const threadActionsDisabled = !workspaceId || create.isPending;
  const composerDisabled = !activeThreadId || isSending;

  const handleSend = useCallback(
    (input: { content: string; mode: string }) => {
      if (sendInFlightRef.current) return;
      sendInFlightRef.current = true;
      setIsSending(true);
      void (async () => {
        try {
          await send({
            content: input.content,
            mode: input.mode,
            scope: await buildScopePayload(),
          });
        } finally {
          sendInFlightRef.current = false;
          setIsSending(false);
        }
      })();
    },
    [buildScopePayload, send],
  );

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
            cancel: { label: t("save_suggestion_cancel"), onClick: () => {} },
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
      className="flex h-full flex-col border-l border-border bg-[var(--theme-surface)]"
    >
      <PanelHeader
        onNewThread={startNewThread}
        newThreadDisabled={threadActionsDisabled}
      />
      <NoteUpdateActionReviewList projectId={activeProjectId} />
      <CodeProjectActionReviewList projectId={activeProjectId} />
      <AgenticPlanCard projectId={activeProjectId} />
      <WorkflowConsoleRuns projectId={activeProjectId} />
      {activeThreadId ? (
        <Conversation
          threadId={activeThreadId}
          live={live}
          onResumeRun={resumeRun}
          onSaveSuggestion={handleSaveSuggestion}
        />
      ) : (
        <AgentPanelEmptyState
          onStart={startNewThread}
          busy={threadActionsDisabled}
        />
      )}
      <ScopeChipsRow
        selected={scope}
        onChange={setScope}
        strict={strict}
        onStrictChange={setStrict}
      />
      {formGenerationEvents.length > 0 ? (
        <div className="border-t border-border p-2">
          <DocumentGenerationCards
            items={asDocumentGenerationCards(formGenerationEvents)}
          />
        </div>
      ) : null}
      <DocumentGenerationForm
        projectId={activeProjectId}
        onEvent={(event) =>
          setFormGenerationEvents((events) => [...events, event])
        }
      />
      <Composer
        disabled={composerDisabled}
        onSend={handleSend}
      />
    </aside>
  );
}
