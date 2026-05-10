"use client";

// Top-level assembly for the agent panel. Owns three pieces of cross-cutting
// state that none of the children should know about individually:
//   1. The active workspace id (resolved from the URL slug) — bootstraps the
//      threads-store so its localStorage-backed `activeThreadId` is loaded
//      before any child renders.
//   2. The user-facing context tray, derived initially from whatever tab the
//      user is currently looking at. Internal retrieval flags stay behind the
//      context manifest instead of leaking as page/project/workspace toggles.
//   3. The "+ new thread" action, shared by the header button and the empty
//      state CTA so both code paths converge on the same mutation.
//   4. The save-suggestion handler (Task 21): validates the SSE payload, tries
//      to insert into the active Plate editor, and falls back to a "create new
//      note" toast action when no Plate editor is open.
// Children (Conversation, Composer, ContextTray) stay controlled views.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { saveSuggestionSchema } from "@opencairn/shared";

import { useChatSend } from "@/hooks/use-chat-send";
import { useChatThreads } from "@/hooks/use-chat-threads";
import { useIngestUpload } from "@/hooks/use-ingest-upload";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { api } from "@/lib/api-client";
import { newTab } from "@/lib/tab-factory";
import {
  createNoteFromMarkdown,
  insertFromMarkdown,
} from "@/lib/notes/insert-from-markdown";
import { useTabsStore } from "@/stores/tabs-store";
import { useThreadsStore } from "@/stores/threads-store";
import { usePanelStore, type AgentPanelTab } from "@/stores/panel-store";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { NotificationListPanel } from "@/components/notifications/notification-list-panel";

import { Composer } from "./composer";
import { Conversation } from "./conversation";
import { DocumentGenerationCards, asDocumentGenerationCards } from "./message-bubble";
import { DocumentGenerationForm } from "./document-generation-form";
import { AgentPanelEmptyState } from "./empty-state";
import { NoteUpdateActionReviewList } from "./note-update-action-review";
import { CodeProjectActionReviewList } from "./code-project-action-review";
import { AgenticPlanCard } from "./agentic-plan-card";
import {
  getAgentCommand,
  type AgentCommand,
  type AgentCommandId,
} from "./agent-commands";
import { PanelHeader } from "./panel-header";
import { ContextTray } from "./context-tray";
import {
  buildAgentContextPayload,
  defaultSourcePolicy,
  type ExternalSearchPolicy,
  type MemoryPolicy,
  type SourcePolicy,
} from "./context-manifest";
import { WorkflowConsoleRuns } from "./workflow-console-runs";
import { WorkbenchActionShelf } from "./workbench-action-shelf";
import { WorkbenchActivityStack } from "./workbench-activity-stack";
import { handleAgentWorkbenchIntent } from "./agent-workbench-intents";
import { useCurrentProjectContext } from "@/components/sidebar/use-current-project";

export function AgentPanel({ wsSlug }: { wsSlug?: string } = {}) {
  const workspaceId = useWorkspaceId(wsSlug);
  const panelTab = usePanelStore((s) => s.agentPanelTab);
  const setPanelTab = usePanelStore((s) => s.setAgentPanelTab);
  const pendingWorkbenchIntent = useAgentWorkbenchStore((s) => s.pendingIntent);
  const consumeWorkbenchIntent = useAgentWorkbenchStore((s) => s.consumeIntent);
  const { projectId: shellProjectId } = useCurrentProjectContext();
  const commandPromptT = useTranslations("agentPanel.composer.slash.prompt");

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
  const { upload, isUploading } = useIngestUpload();

  const activeTabId = useTabsStore((s) => s.activeId);
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === activeTabId));
  const initialSourcePolicy = useMemo(
    () => defaultSourcePolicy(activeTab?.kind),
    [activeTab?.kind],
  );
  const [sourcePolicy, setSourcePolicy] =
    useState<SourcePolicy>(initialSourcePolicy);
  const [memoryPolicy, setMemoryPolicy] = useState<MemoryPolicy>("auto");
  const [externalSearch, setExternalSearch] =
    useState<ExternalSearchPolicy>("off");
  const [isSending, setIsSending] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [formGenerationEvents, setFormGenerationEvents] = useState<unknown[]>([]);
  const sendInFlightRef = useRef(false);
  const buildScopePayload = useCallback(
    (commandId?: AgentCommandId) => {
      const command = getAgentCommand(commandId);
      return buildAgentContextPayload({
        activeTab,
        workspaceId,
        sourcePolicy: command?.contextPatch?.sourcePolicy ?? sourcePolicy,
        memoryPolicy: command?.contextPatch?.memoryPolicy ?? memoryPolicy,
        externalSearch: command?.contextPatch?.externalSearch ?? externalSearch,
        command: commandId,
        fallbackProjectId: shellProjectId,
        resolveNoteProjectId: async (noteId) => {
          try {
            return (await api.getNote(noteId)).projectId;
          } catch {
            return null;
          }
        },
      });
    },
    [activeTab, externalSearch, memoryPolicy, shellProjectId, sourcePolicy, workspaceId],
  );

  // Reset the source policy when the user switches to a different surface kind.
  // Memory/search preferences remain user-selected because those are global
  // working habits, not artifact-specific defaults.
  useEffect(() => {
    setSourcePolicy(defaultSourcePolicy(activeTab?.kind));
  }, [activeTab?.kind]);

  useEffect(() => {
    let cancelled = false;
    async function resolveActiveProject() {
      if (!activeTab) {
        if (!cancelled) setActiveProjectId(shellProjectId);
        return;
      }
      if (activeTab.kind === "project" && activeTab.targetId) {
        if (!cancelled) setActiveProjectId(activeTab.targetId);
        return;
      }
      if (activeTab.kind === "note" && activeTab.targetId) {
        try {
          const note = await api.getNote(activeTab.targetId);
          if (!cancelled) setActiveProjectId(note.projectId ?? shellProjectId);
        } catch {
          if (!cancelled) setActiveProjectId(shellProjectId);
        }
        return;
      }
      if (!cancelled) setActiveProjectId(shellProjectId);
    }
    void resolveActiveProject();
    return () => {
      cancelled = true;
    };
  }, [activeTab, shellProjectId]);

  async function startNewThread() {
    if (!workspaceId) return;
    const { id } = await create.mutateAsync({});
    setActive(id);
  }
  const threadActionsDisabled = !workspaceId || create.isPending;
  const composerDisabled = !workspaceId || isSending || create.isPending;

  const handleSend = useCallback(
    (input: { content: string; mode: string; command?: AgentCommandId }) => {
      if (!workspaceId) return;
      if (sendInFlightRef.current) return;
      sendInFlightRef.current = true;
      setIsSending(true);
      void (async () => {
        try {
          let threadId = activeThreadId;
          if (!threadId) {
            const thread = await create.mutateAsync({});
            threadId = thread.id;
            setActive(thread.id);
          }
          await send({
            content: input.content,
            mode: input.mode,
            scope: await buildScopePayload(input.command),
            threadId,
          });
        } finally {
          sendInFlightRef.current = false;
          setIsSending(false);
        }
      })();
    },
    [activeThreadId, buildScopePayload, create, send, setActive, workspaceId],
  );

  const handleCommand = useCallback((command: AgentCommand) => {
    if (command.contextPatch?.sourcePolicy) {
      setSourcePolicy(command.contextPatch.sourcePolicy);
    }
    if (command.contextPatch?.memoryPolicy) {
      setMemoryPolicy(command.contextPatch.memoryPolicy);
    }
    if (command.contextPatch?.externalSearch) {
      setExternalSearch(command.contextPatch.externalSearch);
    }
  }, []);

  const handleRunAction = useCallback(
    (command: AgentCommand) => {
      handleCommand(command);
      handleSend({
        content: commandPromptT(command.promptKey),
        mode: command.mode ?? "auto",
        command: command.id,
      });
    },
    [commandPromptT, handleCommand, handleSend],
  );

  useEffect(() => {
    if (!workspaceId && pendingWorkbenchIntent?.kind === "runCommand") return;
    handleAgentWorkbenchIntent({
      intent: pendingWorkbenchIntent,
      onRun: handleRunAction,
      onContext: handleCommand,
      consume: consumeWorkbenchIntent,
    });
  }, [
    consumeWorkbenchIntent,
    handleCommand,
    handleRunAction,
    pendingWorkbenchIntent,
    workspaceId,
  ]);

  const handleAttachFile = useCallback(
    (file: File) => {
      if (!activeProjectId) return;
      const noteId =
        activeTab?.kind === "note" && activeTab.targetId
          ? activeTab.targetId
          : undefined;
      void upload(file, activeProjectId, noteId ? { noteId } : undefined).catch(
        () => {},
      );
    },
    [activeProjectId, activeTab, upload],
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
      className="flex h-full flex-col border-l border-border bg-background"
    >
      <PanelHeader
        onNewThread={startNewThread}
        newThreadDisabled={threadActionsDisabled}
      />
      <AgentPanelTabs active={panelTab} onChange={setPanelTab} />
      {panelTab === "activity" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NoteUpdateActionReviewList projectId={activeProjectId} />
          <CodeProjectActionReviewList projectId={activeProjectId} />
          <AgenticPlanCard projectId={activeProjectId} />
          <WorkflowConsoleRuns projectId={activeProjectId} />
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
        </div>
      ) : null}
      {panelTab === "notifications" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NotificationListPanel />
        </div>
      ) : null}
      {panelTab === "chat" ? (
        <>
          <WorkbenchActionShelf
            activeKind={activeTab?.kind}
            disabled={composerDisabled}
            onRun={handleRunAction}
          />
          <WorkbenchActivityStack />
          {activeThreadId ? (
            <Conversation
              threadId={activeThreadId}
              live={live}
              onResumeRun={resumeRun}
              onSaveSuggestion={handleSaveSuggestion}
            />
          ) : (
            <AgentPanelEmptyState />
          )}
          <ContextTray
            activeKind={activeTab?.kind}
            sourcePolicy={sourcePolicy}
            memoryPolicy={memoryPolicy}
            externalSearch={externalSearch}
            onSourcePolicyChange={setSourcePolicy}
            onMemoryPolicyChange={setMemoryPolicy}
            onExternalSearchChange={setExternalSearch}
          />
          <Composer
            disabled={composerDisabled}
            onSend={handleSend}
            onCommand={handleCommand}
            onAttachFile={handleAttachFile}
            attachDisabled={!activeProjectId || isUploading}
          />
        </>
      ) : null}
    </aside>
  );
}

function AgentPanelTabs({
  active,
  onChange,
}: {
  active: AgentPanelTab;
  onChange(tab: AgentPanelTab): void;
}) {
  const t = useTranslations("agentPanel.tabs");
  const tabs: AgentPanelTab[] = ["chat", "activity", "notifications"];

  return (
    <div className="grid grid-cols-3 border-b border-border">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          aria-pressed={active === tab}
          onClick={() => onChange(tab)}
          className={`min-h-9 border-r border-border px-2 text-xs font-medium transition-colors last:border-r-0 ${
            active === tab
              ? "bg-foreground text-background"
              : "bg-background text-muted-foreground hover:text-foreground"
          }`}
        >
          {t(tab)}
        </button>
      ))}
    </div>
  );
}
