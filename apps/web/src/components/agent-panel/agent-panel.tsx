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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { saveSuggestionSchema } from "@opencairn/shared";
import { Activity, Bell, Bot, FileText, Sparkles, Wrench, X } from "lucide-react";

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
import { openOriginalFileTab } from "@/components/ingest/open-original-file-tab";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Composer } from "./composer";
import { Conversation } from "./conversation";
import {
  DocumentGenerationCards,
  asDocumentGenerationCards,
} from "./message-bubble";
import { DocumentGenerationForm } from "./document-generation-form";
import { AgentPanelEmptyState } from "./empty-state";
import { NoteUpdateActionReviewList } from "./note-update-action-review";
import { NoteActionReviewList } from "./note-action-review";
import { CodeProjectActionReviewList } from "./code-project-action-review";
import { InteractionActionList } from "./interaction-action-list";
import { AgenticPlanCard } from "./agentic-plan-card";
import {
  getAgentCommand,
  type AgentCommand,
  type AgentCommandId,
} from "./agent-commands";
import { PanelHeader } from "./panel-header";
import { ProjectToolsPanel } from "./project-tools-panel";
import {
  buildAgentContextPayload,
  type ActionApprovalMode,
  getAgentInvocationContext,
  getAgentInvocationContextLabel,
  defaultSourcePolicy,
  type MemoryPolicy,
  type SourcePolicy,
} from "./context-manifest";
import {
  dataTransferHasFiles,
  dataTransferHasProjectTreeNode,
  readProjectTreeDragPayload,
  type ProjectTreeDragPayload,
} from "@/lib/project-tree-dnd";
import { WorkflowConsoleRuns } from "./workflow-console-runs";
import { WorkbenchActivityStack } from "./workbench-activity-stack";
import { handleAgentWorkbenchIntent } from "./agent-workbench-intents";
import { useCurrentProjectContext } from "@/components/sidebar/use-current-project";
import { getDocumentGenerationPreset } from "./tool-discovery-catalog";
import type { InteractionCardSubmit } from "./interaction-card";
import {
  appendInteractionResponseToScope,
  noteDraftContentFromText,
} from "./interaction-card-actions";

type AgentPanelSendInput = {
  content: string;
  mode: string;
  command?: AgentCommandId;
  interactionResponse?: InteractionCardSubmit;
};

const ACTION_APPROVAL_MODE_STORAGE_KEY = "opencairn:agent:actionApprovalMode";

function initialActionApprovalMode(): ActionApprovalMode {
  if (typeof window === "undefined") return "require";
  return window.localStorage.getItem(ACTION_APPROVAL_MODE_STORAGE_KEY) ===
    "auto_safe"
    ? "auto_safe"
    : "require";
}

export function AgentPanel({ wsSlug }: { wsSlug?: string } = {}) {
  const workspaceId = useWorkspaceId(wsSlug);
  const panelTab = usePanelStore((s) => s.agentPanelTab);
  const setPanelTab = usePanelStore((s) => s.setAgentPanelTab);
  const pendingWorkbenchIntent = useAgentWorkbenchStore((s) => s.pendingIntent);
  const consumeWorkbenchIntent = useAgentWorkbenchStore((s) => s.consumeIntent);
  const pendingDocumentGenerationPresetIntent = useAgentWorkbenchStore(
    (s) => s.pendingDocumentGenerationPreset,
  );
  const consumeDocumentGenerationPreset = useAgentWorkbenchStore(
    (s) => s.consumeDocumentGenerationPreset,
  );
  const { projectId: shellProjectId } = useCurrentProjectContext();
  const composerT = useTranslations("agentPanel.composer");
  const commandPromptT = useTranslations("agentPanel.composer.slash.prompt");

  // setWorkspace bootstraps the active-thread restore from localStorage on
  // every workspace/project switch so changing projects does not carry over
  // the previous project's selected thread.
  const setWorkspace = useThreadsStore((s) => s.setWorkspace);
  useEffect(() => {
    if (workspaceId) setWorkspace(workspaceId, shellProjectId);
  }, [shellProjectId, workspaceId, setWorkspace]);

  const activeThreadId = useThreadsStore((s) => s.activeThreadId);
  const setActive = useThreadsStore((s) => s.setActiveThread);
  const { create } = useChatThreads(workspaceId, shellProjectId);
  const { send, live, pendingUser, resumeRun } = useChatSend(activeThreadId);
  const { upload, isUploading } = useIngestUpload();
  const uploadT = useTranslations("sidebar.upload");

  const activeTabId = useTabsStore((s) => s.activeId);
  const activeTab = useTabsStore((s) =>
    s.tabs.find((t) => t.id === activeTabId),
  );
  const initialSourcePolicy = useMemo(
    () => defaultSourcePolicy(activeTab?.kind),
    [activeTab?.kind],
  );
  const [sourcePolicy, setSourcePolicy] =
    useState<SourcePolicy>(initialSourcePolicy);
  const [memoryPolicy, setMemoryPolicy] = useState<MemoryPolicy>("auto");
  const [actionApprovalMode, setActionApprovalMode] =
    useState<ActionApprovalMode>(initialActionApprovalMode);
  const [activeContextEnabled, setActiveContextEnabled] = useState(true);
  const [selectionText, setSelectionText] = useState("");
  const [draggingReference, setDraggingReference] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [attachedReferences, setAttachedReferences] = useState<
    ProjectTreeDragPayload[]
  >([]);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState(false);
  const [composerFocusKey, setComposerFocusKey] = useState(0);
  const [formGenerationEvents, setFormGenerationEvents] = useState<unknown[]>(
    [],
  );
  const pendingDocumentGenerationPreset = pendingDocumentGenerationPresetIntent
    ? getDocumentGenerationPreset(pendingDocumentGenerationPresetIntent.presetId)
    : null;
  const sendInFlightRef = useRef(false);
  const autoSavedSuggestionKeysRef = useRef(new Set<string>());
  useEffect(() => {
    window.localStorage.setItem(
      ACTION_APPROVAL_MODE_STORAGE_KEY,
      actionApprovalMode,
    );
  }, [actionApprovalMode]);

  useEffect(() => {
    let timeoutId: number | undefined;
    function updateSelectionText() {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        setSelectionText(window.getSelection()?.toString() ?? "");
      }, 200);
    }
    document.addEventListener("selectionchange", updateSelectionText);
    return () => {
      document.removeEventListener("selectionchange", updateSelectionText);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  const invocationContext = useMemo(
    () =>
      activeContextEnabled
        ? getAgentInvocationContext(activeTab, { selectionText })
        : null,
    [activeContextEnabled, activeTab, selectionText],
  );
  const invocationContextLabel = useMemo(
    () => getAgentInvocationContextLabel(invocationContext),
    [invocationContext],
  );
  const buildScopePayload = useCallback(
    async (
      commandId?: AgentCommandId,
      interactionResponse?: AgentPanelSendInput["interactionResponse"],
    ) => {
      const command = getAgentCommand(commandId);
      const scopedActiveTab = activeContextEnabled ? activeTab : undefined;
      const payload = await buildAgentContextPayload({
        activeTab: scopedActiveTab,
        workspaceId,
        sourcePolicy: command?.contextPatch?.sourcePolicy ?? sourcePolicy,
        memoryPolicy: command?.contextPatch?.memoryPolicy ?? memoryPolicy,
        externalSearch: "allowed",
        actionApprovalMode,
        command: commandId,
        fallbackProjectId: activeProjectId ?? shellProjectId,
        attachedReferences,
        resolveNoteProjectId: async (noteId) => {
          try {
            return (await api.getNote(noteId)).projectId;
          } catch {
            return null;
          }
        },
      });
      const contextPayload = invocationContext
        ? { ...payload, invocationContext }
        : payload;
      return interactionResponse
        ? appendInteractionResponseToScope(contextPayload, interactionResponse)
        : contextPayload;
    },
    [
      activeTab,
      activeContextEnabled,
      actionApprovalMode,
      activeProjectId,
      attachedReferences,
      invocationContext,
      memoryPolicy,
      shellProjectId,
      sourcePolicy,
      workspaceId,
    ],
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

  function startNewThread() {
    setActive(null);
    setComposerFocusKey((current) => current + 1);
  }
  const threadActionsDisabled = !workspaceId;
  const composerDisabled = !workspaceId || isSending || create.isPending;

  const handleSend = useCallback(
    (input: AgentPanelSendInput) => {
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
            scope: await buildScopePayload(
              input.command,
              input.interactionResponse,
            ),
            threadId,
          });
          setAttachedReferences([]);
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

  const uploadAndAttachFile = useCallback(
    async (file: File) => {
      if (!activeProjectId) return;
      const noteId =
        activeTab?.kind === "note" && activeTab.targetId
          ? activeTab.targetId
          : undefined;
      const result = await upload(
        file,
        activeProjectId,
        noteId ? { noteId } : undefined,
      );
      if (result.originalFileId) {
        openOriginalFileTab(result.originalFileId, file.name);
      }
      const sourceBundleNodeId = result.sourceBundleNodeId;
      if (!sourceBundleNodeId) return;
      setAttachedReferences((current) => {
        if (current.some((item) => item.id === sourceBundleNodeId)) {
          return current;
        }
        return [
          ...current,
          {
            id: sourceBundleNodeId,
            targetId: sourceBundleNodeId,
            kind: "source_bundle",
            label: file.name,
            parentId: null,
          },
        ];
      });
    },
    [activeProjectId, activeTab, upload],
  );

  const handleAttachFile = useCallback(
    (file: File) => {
      void uploadAndAttachFile(file).catch(() => {});
    },
    [uploadAndAttachFile],
  );

  const startPendingUpload = useCallback(() => {
    if (!pendingUploadFile) return;
    setUploadError(false);
    void uploadAndAttachFile(pendingUploadFile)
      .then(() => {
        setPendingUploadFile(null);
      })
      .catch((err) => {
        console.error("agent panel file upload failed", err);
        setUploadError(true);
      });
  }, [pendingUploadFile, uploadAndAttachFile]);

  const handleAttachTreeNode = useCallback((node: ProjectTreeDragPayload) => {
    setAttachedReferences((current) => {
      if (current.some((item) => item.id === node.id)) return current;
      return [...current, node];
    });
  }, []);

  const handleRemoveTreeReference = useCallback((id: string) => {
    setAttachedReferences((current) =>
      current.filter((item) => item.id !== id),
    );
  }, []);

  const handlePanelDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (
      dataTransferHasFiles(event.dataTransfer) ||
      dataTransferHasProjectTreeNode(event.dataTransfer)
    ) {
      event.preventDefault();
      setDraggingReference(true);
      event.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handlePanelDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }
    setDraggingReference(false);
  }, []);

  const handlePanelDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      setDraggingReference(false);
      const treeNode = readProjectTreeDragPayload(event.dataTransfer);
      if (treeNode) {
        event.preventDefault();
        handleAttachTreeNode(treeNode);
        setPanelTab("chat");
        return;
      }
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      setUploadError(false);
      setPendingUploadFile(Array.from(event.dataTransfer.files)[0] ?? null);
      setPanelTab("chat");
    },
    [handleAttachTreeNode, setPanelTab],
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

  const handleInteractionCardSubmit = useCallback(
    (input: InteractionCardSubmit) => {
      if (!workspaceId || sendInFlightRef.current) return;

      handleSend({
        content: input.value,
        mode: "auto",
        interactionResponse: input,
      });

      const action = input.option?.action;
      if (action?.type !== "create_note_draft") return;

      const projectId = activeProjectId;
      const contextTitle = activeTab?.title;
      const inputValue = input.value;
      const inputLabel = input.label;
      void (async () => {
        if (!projectId) {
          toast.error(t("interaction_note_failed"));
          return;
        }
        const title =
          action.title ??
          `${inputLabel} - ${contextTitle ?? t("interaction_note_title")}`;
        const note = await api.createNote({
          projectId,
          title,
          content: noteDraftContentFromText(
            action.body ?? inputValue,
            contextTitle,
          ),
        });
        useTabsStore.getState().addTab(
          newTab({
            kind: "note",
            targetId: note.id,
            title: note.title,
            mode: "plate",
            preview: false,
          }),
        );
      })().catch(() => toast.error(t("interaction_note_failed")));
    },
    [activeProjectId, activeTab?.title, handleSend, t, workspaceId],
  );

  const handleInteractionActionAnswered = useCallback(
    (input: InteractionCardSubmit) => {
      if (!workspaceId || sendInFlightRef.current) return;
      handleSend({
        content: input.value,
        mode: "auto",
        interactionResponse: input,
      });
    },
    [handleSend, workspaceId],
  );

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
          activeTab?.kind === "note"
            ? (activeTab.targetId ?? undefined)
            : undefined,
        // mode is the TabMode string; "plate" indicates the Plate editor.
        activeNoteIsPlate:
          activeTab?.kind === "note" && activeTab.mode === "plate",
        apiCreateNote,
        onSuccess: () => {
          toast.success(t("save_suggestion_inserted_active"));
        },
        onMissingTarget: () => {
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
              toast.success(t("save_suggestion_created_new"));
            },
            onError: () => toast.error(t("save_suggestion_failed")),
          });
        },
        onCreatedNote: () => {},
        onError: () => toast.error(t("save_suggestion_failed")),
      });
    },
    [activeTab, t, resolveProjectId],
  );

  useEffect(() => {
    if (actionApprovalMode !== "auto_safe") return;
    const suggestion = live?.save_suggestion;
    if (!suggestion) return;
    const key = JSON.stringify(suggestion);
    if (autoSavedSuggestionKeysRef.current.has(key)) return;
    autoSavedSuggestionKeysRef.current.add(key);
    void handleSaveSuggestion(suggestion);
  }, [actionApprovalMode, handleSaveSuggestion, live?.save_suggestion]);

  return (
    <aside
      data-testid="app-shell-agent-panel"
      className="relative flex h-full flex-col border-l border-border bg-background"
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
    >
      {draggingReference ? (
        <div className="pointer-events-none absolute inset-2 z-30 rounded-[var(--radius-card)] border border-dashed border-foreground/35">
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
            {composerT("dropHint")}
          </div>
        </div>
      ) : null}
      <AgentPanelTabs active={panelTab} onChange={setPanelTab} />
      <PanelHeader
        onNewThread={startNewThread}
        newThreadDisabled={threadActionsDisabled}
      />
      {panelTab === "activity" ? (
        <div className="app-scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <NoteActionReviewList projectId={activeProjectId} />
          <InteractionActionList
            projectId={activeProjectId}
            onAnswered={handleInteractionActionAnswered}
          />
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
            pendingPreset={pendingDocumentGenerationPreset}
            onPresetConsumed={() => {
              if (pendingDocumentGenerationPresetIntent) {
                consumeDocumentGenerationPreset(
                  pendingDocumentGenerationPresetIntent.id,
                );
              }
            }}
            onEvent={(event) =>
              setFormGenerationEvents((events) => [...events, event])
            }
          />
        </div>
      ) : null}
      {panelTab === "notifications" ? (
        <div className="app-scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <NotificationListPanel />
        </div>
      ) : null}
      {panelTab === "tools" ? (
        <ProjectToolsPanel
          projectId={activeProjectId}
          workspaceId={workspaceId}
          wsSlug={wsSlug}
          onRun={handleRunAction}
          onOpenActivity={() => setPanelTab("activity")}
        />
      ) : null}
      {panelTab === "chat" ? (
        <>
          <WorkbenchActivityStack />
          {activeThreadId ? (
            <Conversation
              threadId={activeThreadId}
              live={live}
              pendingUser={pendingUser}
              onResumeRun={resumeRun}
              onSaveSuggestion={handleSaveSuggestion}
              onInteractionCardSubmit={handleInteractionCardSubmit}
              onThreadUnavailable={() => setActive(null)}
              emptyState={
                <AgentPanelEmptyState
                  hasContext={Boolean(
                    invocationContextLabel || attachedReferences.length,
                  )}
                  onSuggestion={(content) =>
                    handleSend({ content, mode: "auto" })
                  }
                />
              }
            />
          ) : (
            <AgentPanelEmptyState
              hasContext={Boolean(
                invocationContextLabel || attachedReferences.length,
              )}
              onSuggestion={(content) =>
                handleSend({ content, mode: "auto" })
              }
            />
          )}
          <div className="border-t border-border bg-background pt-2">
            <ComposerContextStrip
              activeLabel={invocationContextLabel}
              references={attachedReferences}
              onRemoveReference={handleRemoveTreeReference}
            />
            <Composer
              disabled={composerDisabled}
              onSend={handleSend}
              onCommand={handleCommand}
              onAttachFile={handleAttachFile}
              onAttachTreeNode={handleAttachTreeNode}
              activeContextLabel={
                activeTab?.targetId ? activeTab.title : undefined
              }
              activeContextEnabled={activeContextEnabled}
              onToggleActiveContext={() =>
                setActiveContextEnabled((current) => !current)
              }
              actionApprovalMode={actionApprovalMode}
              onToggleActionApprovalMode={() =>
                setActionApprovalMode((current) =>
                  current === "require" ? "auto_safe" : "require",
                )
              }
              attachDisabled={!activeProjectId || isUploading}
              focusKey={composerFocusKey}
            />
          </div>
        </>
      ) : null}
      <Dialog
        open={Boolean(pendingUploadFile)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingUploadFile(null);
            setUploadError(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{uploadT("title")}</DialogTitle>
            <DialogDescription>{uploadT("description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm">
              <p className="font-medium">
                {pendingUploadFile
                  ? uploadT("selected", { name: pendingUploadFile.name })
                  : uploadT("drop")}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {uploadT("hint")}
              </p>
            </div>
            {uploadError ? (
              <p role="alert" className="text-sm text-destructive">
                {uploadT("error")}
              </p>
            ) : null}
            <button
              type="button"
              disabled={!pendingUploadFile || isUploading}
              onClick={startPendingUpload}
              className="inline-flex min-h-10 w-full items-center justify-center rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUploading ? uploadT("uploading") : uploadT("start")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
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
  const tabs: AgentPanelTab[] = ["chat", "tools", "activity", "notifications"];
  const icons = {
    chat: Bot,
    tools: Wrench,
    activity: Activity,
    notifications: Bell,
  } satisfies Record<AgentPanelTab, typeof Bot>;

  return (
    <div className="grid grid-cols-4 border-b border-border">
      {tabs.map((tab) => {
        const Icon = icons[tab];
        return (
          <button
            key={tab}
            type="button"
            aria-pressed={active === tab}
            onClick={() => onChange(tab)}
            className={`inline-flex min-h-8 items-center justify-center gap-1 border-r border-border px-1.5 text-[11px] font-medium leading-none transition-colors last:border-r-0 ${
              active === tab
                ? "bg-foreground text-background"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t(tab)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ComposerContextStrip({
  activeLabel,
  references,
  onRemoveReference,
}: {
  activeLabel: ReturnType<typeof getAgentInvocationContextLabel>;
  references: ProjectTreeDragPayload[];
  onRemoveReference(id: string): void;
}) {
  const t = useTranslations("agentPanel.composer");
  if (!activeLabel && references.length === 0) return null;

  return (
    <div
      data-testid="agent-composer-context-strip"
      className="app-scrollbar-thin mx-2 mb-1 flex max-h-16 gap-1 overflow-x-auto overflow-y-hidden pb-1"
    >
      {activeLabel ? (
        <span className="inline-flex max-w-[180px] shrink-0 items-center gap-1 rounded-[var(--radius-control)] border border-border bg-muted/35 px-2 py-1 text-xs text-muted-foreground">
          <FileText aria-hidden className="h-3 w-3 shrink-0" />
          <span className="shrink-0 text-[10px] uppercase">
            {t(activeLabel.labelKey, {
              count: activeLabel.selectionCount ?? 0,
            })}
          </span>
          {activeLabel.title ? (
            <span className="truncate text-foreground">{activeLabel.title}</span>
          ) : null}
        </span>
      ) : null}
      {references.map((reference) => (
        <span
          key={reference.id}
          className="inline-flex max-w-[180px] shrink-0 items-center gap-1 rounded-[var(--radius-control)] border border-border bg-muted/35 px-2 py-1 text-xs text-muted-foreground"
        >
          <Sparkles aria-hidden className="h-3 w-3 shrink-0" />
          <span className="shrink-0 text-[10px] uppercase">
            {t("context.pinned")}
          </span>
          <span className="truncate text-foreground">{reference.label}</span>
          <button
            type="button"
            aria-label={t("reference.remove_aria")}
            onClick={() => onRemoveReference(reference.id)}
            className="grid h-4 w-4 shrink-0 place-items-center rounded-[var(--radius-control)] hover:bg-background hover:text-foreground"
          >
            <X aria-hidden className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
