"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  enrichmentResponseSchema,
  type BacklinksResponse,
  type EnrichmentResponse,
} from "@opencairn/shared";
import {
  Activity,
  AlertCircle,
  BookOpen,
  CheckSquare,
  FilePlus2,
  FileSearch,
  ListChecks,
  Loader2,
  Mic2,
  Network,
  Play,
  Quote,
  Sparkles,
  Square,
  Table2,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { NoteUpdateActionReviewList } from "@/components/agent-panel/note-update-action-review";
import {
  getToolDiscoveryItemsForSurface,
  type ToolDiscoveryItem,
} from "@/components/agent-panel/tool-discovery-catalog";
import { workflowForSourceToolItem } from "@/components/agent-panel/tool-discovery-actions";
import { WorkbenchActivityStack } from "@/components/agent-panel/workbench-activity-stack";
import {
  WorkbenchActivityButton,
  WorkbenchCommandButton,
  WorkbenchContextButton,
  WorkbenchWorkflowButton,
} from "@/components/agent-panel/workbench-trigger-button";
import type { GroundedGraphResponse } from "@/components/graph/grounded-types";
import { studySessionsApi, type SessionRecording } from "@/lib/api-client";
import { urls } from "@/lib/urls";

type SourceRailTab = "analysis" | "wiki" | "study" | "activity";

interface SourceContextRailProps {
  noteId: string;
  projectId: string | null;
  wsSlug: string | null;
  sourceTitle: string;
  viewerElementId: string;
  sourceContentType?: string | null;
}

export function SourceContextRail({
  noteId,
  projectId,
  wsSlug,
  sourceTitle,
  viewerElementId,
  sourceContentType,
}: SourceContextRailProps) {
  const t = useTranslations("appShell.viewers.source.rail");
  const [active, setActive] = useState<SourceRailTab | null>("analysis");
  const [selectedText, setSelectedText] = useState("");

  const openTab = (tab: SourceRailTab) => {
    setActive(active === tab ? null : tab);
  };

  useEffect(() => {
    function updateSelection() {
      const root = document.getElementById(viewerElementId);
      const selection = window.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const text = selection?.toString().trim() ?? "";
      if (!root || !anchor || !root.contains(anchor) || text.length === 0) {
        setSelectedText("");
        return;
      }
      setSelectedText(text.slice(0, 180));
    }
    document.addEventListener("selectionchange", updateSelection);
    updateSelection();
    return () => {
      document.removeEventListener("selectionchange", updateSelection);
    };
  }, [viewerElementId]);

  return (
    <aside
      aria-label={t("title")}
      data-testid="source-context-rail"
      data-note-id={noteId}
      className="flex shrink-0 flex-col border-t border-border bg-background text-foreground xl:flex-row xl:border-l xl:border-t-0"
    >
      <div className="flex min-h-11 items-center gap-1 border-b border-border px-2 py-1 xl:min-h-0 xl:w-12 xl:flex-col xl:border-b-0 xl:border-r xl:px-1 xl:py-2">
        <RailButton
          active={active === "analysis"}
          label={t("analysis")}
          onClick={() => openTab("analysis")}
        >
          <FileSearch aria-hidden className="h-4 w-4" />
        </RailButton>
        <RailButton
          active={active === "activity"}
          label={t("activity")}
          onClick={() => openTab("activity")}
        >
          <Activity aria-hidden className="h-4 w-4" />
        </RailButton>
        <RailButton
          active={active === "wiki"}
          label={t("wiki")}
          onClick={() => openTab("wiki")}
        >
          <Network aria-hidden className="h-4 w-4" />
        </RailButton>
        <RailButton
          active={active === "study"}
          label={t("study")}
          onClick={() => openTab("study")}
        >
          <BookOpen aria-hidden className="h-4 w-4" />
        </RailButton>
      </div>

      {active ? (
        <section
          data-testid="source-context-rail-panel"
          className="flex min-h-0 w-full flex-col border-t border-border xl:w-80 xl:border-t-0"
        >
          <header className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
            <h2 className="text-sm font-semibold">{t(active)}</h2>
            <button
              type="button"
              aria-label={t("close")}
              className="app-hover inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)]"
              onClick={() => setActive(null)}
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </header>
          <div
            data-testid="source-context-rail-scroll"
            className="app-scrollbar-thin min-h-0 flex-1 overflow-y-auto"
          >
            {active === "analysis" ? (
              <SourceRailAnalysis
                noteId={noteId}
                selectedText={selectedText}
                projectId={projectId}
                sourceTitle={sourceTitle}
                sourceContentType={sourceContentType}
              />
            ) : null}
            {active === "wiki" ? (
              <SourceRailWiki
                noteId={noteId}
                projectId={projectId}
                wsSlug={wsSlug}
              />
            ) : null}
            {active === "study" ? (
              <SourceRailStudy
                noteId={noteId}
                projectId={projectId}
                sourceTitle={sourceTitle}
              />
            ) : null}
            {active === "activity" ? (
              <SourceRailActivity projectId={projectId} />
            ) : null}
          </div>
        </section>
      ) : null}
    </aside>
  );
}

function RailButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SourceRailCapabilityButton({
  item,
  projectId,
  noteId,
  sourceTitle,
  title,
}: {
  item: ToolDiscoveryItem;
  projectId: string | null;
  noteId: string;
  sourceTitle: string;
  title: string;
}) {
  const Icon = sourceRailIcon(item);
  const testId =
    item.id === "paper_analysis"
      ? "source-rail-paper-analysis-button"
      : `source-rail-capability-${item.id}`;
  return (
    <WorkbenchWorkflowButton
      workflow={workflowForSourceToolItem(item, { noteId, sourceTitle })}
      preflight={
        item.preflight
          ? {
              projectId,
              profile: item.preflight.tool,
              sourceTokenEstimate: item.preflight.sourceTokenEstimate,
            }
          : undefined
      }
      data-testid={testId}
      className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
    >
      <Icon aria-hidden className="h-4 w-4" />
      {title}
    </WorkbenchWorkflowButton>
  );
}

function sourceRailIcon(item: ToolDiscoveryItem): LucideIcon {
  if (item.icon === "table") return Table2;
  if (item.icon === "graduation") return BookOpen;
  if (item.id === "paper_analysis") return FilePlus2;
  return Sparkles;
}

function sourceTypeFromContentType(contentType: string | null | undefined) {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("pdf")) return "pdf";
  if (
    normalized.includes("presentation") ||
    normalized.includes("powerpoint")
  ) {
    return "deck";
  }
  if (
    normalized.includes("spreadsheet") ||
    normalized.includes("csv") ||
    normalized.includes("excel")
  ) {
    return "table";
  }
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/") || normalized.startsWith("video/")) {
    return "recording";
  }
  if (
    normalized.includes("wordprocessing") ||
    normalized.includes("text") ||
    normalized.includes("markdown")
  ) {
    return "document";
  }
  return "source";
}

function SourceRailWiki({
  noteId,
  projectId,
  wsSlug,
}: {
  noteId: string;
  projectId: string | null;
  wsSlug: string | null;
}) {
  const t = useTranslations("appShell.viewers.source.rail");
  const locale = useLocale();
  const backlinksQuery = useQuery<BacklinksResponse>({
    queryKey: ["source-rail-backlinks", noteId],
    enabled: Boolean(noteId),
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/notes/${noteId}/backlinks`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`backlinks ${res.status}`);
      return (await res.json()) as BacklinksResponse;
    },
  });
  const graphQuery = useQuery<GroundedGraphResponse>({
    queryKey: ["source-rail-graph", projectId],
    enabled: Boolean(projectId),
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/projects/${projectId}/knowledge-surface?view=cards&includeEvidence=true`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`graph ${res.status}`);
      return (await res.json()) as GroundedGraphResponse;
    },
  });
  const backlinks = backlinksQuery.data?.data ?? [];
  const graph = graphQuery.data;
  const topConcepts = graph?.nodes.slice(0, 5) ?? [];
  const graphHref =
    projectId && wsSlug
      ? `${urls.workspace.projectGraph(locale, wsSlug, projectId)}?view=cards`
      : null;

  return (
    <div className="space-y-3 p-3">
      <p className="text-xs leading-5 text-muted-foreground">
        {t("wikiDescription")}
      </p>
      <section className="space-y-2 rounded-[var(--radius-card)] border border-border p-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium">{t("wikiBacklinksTitle")}</h3>
          <span className="text-[11px] text-muted-foreground">
            {backlinksQuery.data?.total ?? 0}
          </span>
        </div>
        {backlinks.length === 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {t("wikiBacklinksEmpty")}
          </p>
        ) : (
          <div className="space-y-1">
            {backlinks.slice(0, 5).map((backlink) => (
              <Link
                key={backlink.id}
                href={wsSlug ? urls.workspace.note(locale, wsSlug, backlink.id) : "#"}
                className="block rounded-[var(--radius-control)] border border-border px-2 py-1.5 text-xs hover:bg-muted/50"
              >
                <span className="block truncate font-medium">{backlink.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {backlink.projectName}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
      <section className="space-y-2 rounded-[var(--radius-card)] border border-border p-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium">{t("wikiGraphTitle")}</h3>
          {graphHref ? (
            <Link
              href={graphHref}
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] border border-border px-2 text-[11px] hover:bg-muted/50"
            >
              <Workflow aria-hidden className="h-3 w-3" />
              {t("wikiGraphOpen")}
            </Link>
          ) : null}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {t("wikiGraphSummary", {
            count: graph?.totalConcepts ?? 0,
            edgeCount: graph?.edges.length ?? 0,
          })}
        </p>
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">
            {t("wikiConceptsTitle")}
          </div>
          {topConcepts.length === 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {t("wikiConceptsEmpty")}
            </p>
          ) : (
            topConcepts.map((node) => (
              <div
                key={node.id}
                className="rounded-[var(--radius-control)] bg-muted/35 px-2 py-1.5"
              >
                <div className="truncate text-xs font-medium">{node.name}</div>
                {node.description ? (
                  <div className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                    {node.description}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function SourceRailAnalysis({
  noteId,
  selectedText,
  projectId,
  sourceTitle,
  sourceContentType,
}: {
  noteId: string;
  selectedText: string;
  projectId: string | null;
  sourceTitle: string;
  sourceContentType?: string | null;
}) {
  const t = useTranslations("appShell.viewers.source.rail");
  const selectedCount = selectedText.length;
  const sourceLabel = t(
    `sourceTypes.${sourceTypeFromContentType(sourceContentType)}`,
  );
  const sourceWorkflowItems = getToolDiscoveryItemsForSurface("source_rail", {
    contexts: ["source"],
    contentType: sourceContentType,
  }).filter((item) =>
    [
      "paper_analysis",
      "source_figure",
      "study_artifact_generator",
    ].includes(item.id),
  );
  const enrichmentQuery = useQuery<EnrichmentResponse | null>({
    queryKey: ["source-rail-enrichment", noteId],
    enabled: Boolean(noteId),
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/notes/${noteId}/enrichment`, {
        credentials: "include",
        signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`enrichment ${res.status}`);
      const parsed = enrichmentResponseSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("enrichment_payload_invalid");
      return parsed.data;
    },
  });
  const sourceReadiness = getSourceReadiness(enrichmentQuery.data ?? null);

  return (
    <div className="space-y-3 p-3">
      <p className="text-xs leading-5 text-muted-foreground">
        {t("analysisDescription")}
      </p>
      {sourceReadiness ? (
        <SourceReadinessNotice readiness={sourceReadiness} />
      ) : null}
      <div className="rounded-[var(--radius-card)] border border-border bg-muted/25 p-2">
        <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
          {t("selectionTitle")}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {selectedCount > 0
            ? t("selectionActive", { count: selectedCount })
            : t("selectionEmpty")}
        </p>
        {selectedCount > 0 ? (
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-foreground">
            {selectedText}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <WorkbenchContextButton
          commandId="current_document_only"
          data-testid="source-rail-current-pdf-button"
          className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
        >
          <FileSearch aria-hidden className="h-4 w-4" />
          {t("useThisSource", { source: sourceLabel })}
        </WorkbenchContextButton>
        {sourceWorkflowItems.map((item) => (
          <SourceRailCapabilityButton
            key={item.id}
            item={item}
            projectId={projectId}
            noteId={noteId}
            sourceTitle={sourceTitle}
            title={t(`capabilities.${item.id}`)}
          />
        ))}
        <WorkbenchCommandButton
          commandId="summarize"
          preflight={{
            projectId,
            profile: "summary",
            sourceTokenEstimate: 8000,
          }}
          data-testid="source-rail-summarize-button"
          className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
        >
          <Sparkles aria-hidden className="h-4 w-4" />
          {t("summarize")}
        </WorkbenchCommandButton>
        <WorkbenchCommandButton
          commandId="decompose"
          data-testid="source-rail-decompose-button"
          className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
        >
          <ListChecks aria-hidden className="h-4 w-4" />
          {t("decompose")}
        </WorkbenchCommandButton>
        <WorkbenchCommandButton
          commandId="extract_citations"
          data-testid="source-rail-citations-button"
          className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
        >
          <Quote aria-hidden className="h-4 w-4" />
          {t("citations")}
        </WorkbenchCommandButton>
        <WorkbenchActivityButton
          data-testid="source-rail-review-button"
          className="app-hover inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm"
        >
          <CheckSquare aria-hidden className="h-4 w-4" />
          {t("review")}
        </WorkbenchActivityButton>
      </div>
    </div>
  );
}

function getSourceReadiness(
  enrichment: EnrichmentResponse | null,
): "processing" | "failed" | "unsupported" | null {
  if (!enrichment) return null;
  if (hasUnsupportedSourceReason(enrichment.skipReasons)) return "unsupported";
  if (enrichment.status === "pending" || enrichment.status === "processing") {
    return "processing";
  }
  if (enrichment.status === "failed") return "failed";
  return null;
}

function hasUnsupportedSourceReason(skipReasons: string[]) {
  return skipReasons.some((reason) => {
    const normalized = reason.toLowerCase();
    return (
      normalized.includes("unsupported_source") ||
      normalized.includes("source_unsupported") ||
      normalized.includes("mime_unsupported") ||
      normalized.includes("parser_unsupported")
    );
  });
}

function SourceReadinessNotice({
  readiness,
}: {
  readiness: "processing" | "failed" | "unsupported";
}) {
  const t = useTranslations("appShell.viewers.source.rail");
  const destructive = readiness === "failed" || readiness === "unsupported";
  const label =
    readiness === "processing"
      ? t("sourceProcessing")
      : readiness === "unsupported"
        ? t("sourceUnsupported")
        : t("sourceFailed");

  return (
    <div
      data-testid={`source-readiness-${readiness}`}
      className={`flex items-start gap-2 rounded-[var(--radius-card)] border p-2 text-xs leading-5 ${
        destructive
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-border bg-muted/25 text-muted-foreground"
      }`}
    >
      {readiness === "processing" ? (
        <Loader2 aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        <AlertCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <span>{label}</span>
    </div>
  );
}

function SourceRailActivity({ projectId }: { projectId: string | null }) {
  const t = useTranslations("appShell.viewers.source.rail");

  return (
    <div className="min-h-0">
      <p className="border-b border-border p-3 text-xs leading-5 text-muted-foreground">
        {t("activityDescription")}
      </p>
      <NoteUpdateActionReviewList projectId={projectId} />
      <WorkbenchActivityStack />
    </div>
  );
}

function SourceRailStudy({
  noteId,
  projectId,
  sourceTitle,
}: {
  noteId: string;
  projectId: string | null;
  sourceTitle: string;
}) {
  const t = useTranslations("appShell.viewers.source.rail");
  const queryClient = useQueryClient();
  const [recordingState, setRecordingState] = useState<
    "idle" | "recording" | "uploading" | "failed"
  >("idle");
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [activePlaybackRecordingId, setActivePlaybackRecordingId] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const sessionsQuery = useQuery({
    queryKey: ["study-sessions", projectId, noteId],
    enabled: Boolean(projectId),
    queryFn: () =>
      studySessionsApi.list(projectId!, {
        sourceNoteId: noteId,
      }),
  });
  const activeSession = sessionsQuery.data?.sessions[0] ?? null;
  const recordingsQuery = useQuery({
    queryKey: ["study-session-recordings", activeSession?.id ?? null],
    enabled: Boolean(activeSession),
    queryFn: () => studySessionsApi.recordings(activeSession!.id),
    refetchInterval: activeSession ? 3000 : false,
  });
  const transcriptQuery = useQuery({
    queryKey: ["study-session-transcript", activeSession?.id ?? null],
    enabled: Boolean(activeSession),
    queryFn: () => studySessionsApi.transcript(activeSession!.id),
    refetchInterval: activeSession ? 3000 : false,
  });
  const createSession = useMutation({
    mutationFn: () => {
      if (!projectId) throw new Error("missing_project");
      return studySessionsApi.create({
        projectId,
        sourceNoteId: noteId,
        title: sourceTitle.trim() || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["study-sessions", projectId, noteId],
      });
    },
  });
  const uploadRecording = useMutation({
    mutationFn: (input: { file: File; durationSec: number }) => {
      if (!activeSession) throw new Error("missing_session");
      return studySessionsApi.uploadRecording(activeSession.id, input.file, {
        durationSec: input.durationSec,
      });
    },
    onSuccess: () => {
      setRecordingState("idle");
      setRecordingError(null);
      void queryClient.invalidateQueries({
        queryKey: ["study-session-recordings", activeSession?.id ?? null],
      });
      void queryClient.invalidateQueries({
        queryKey: ["study-session-transcript", activeSession?.id ?? null],
      });
    },
    onError: () => {
      setRecordingState("failed");
      setRecordingError(t("recordingUploadFailed"));
    },
  });

  const recordings = recordingsQuery.data?.recordings ?? [];
  const segments = transcriptQuery.data?.segments ?? [];
  const readyRecordings = recordings.filter((recording) => recording.status === "ready");
  const failedRecordings = recordings.filter(
    (recording) => recording.status === "failed" || recording.transcriptStatus === "failed",
  );
  const processingRecordings = recordings.filter(
    (recording) =>
      recording.status === "processing"
      || recording.transcriptStatus === "pending"
      || recording.transcriptStatus === "processing",
  );
  const activePlaybackRecording =
    readyRecordings.find((recording) => recording.id === activePlaybackRecordingId)
    ?? readyRecordings[0]
    ?? null;
  const hasPendingTranscript = recordings.some((recording) =>
    recording.transcriptStatus === "pending"
    || recording.transcriptStatus === "processing"
  );
  const canRecord = Boolean(activeSession) && recordingState !== "recording" && recordingState !== "uploading";
  const mediaSupported =
    typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== "undefined";

  useEffect(() => {
    if (activePlaybackRecording && activePlaybackRecordingId !== activePlaybackRecording.id) {
      setActivePlaybackRecordingId(activePlaybackRecording.id);
    }
  }, [activePlaybackRecording, activePlaybackRecordingId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const stopTimer = () => {
    if (!timerRef.current) return;
    clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    if (!activeSession || !mediaSupported) return;
    try {
      setRecordingError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const preferredMime = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ].find((mime) =>
        typeof MediaRecorder.isTypeSupported === "function"
          ? MediaRecorder.isTypeSupported(mime)
          : false,
      );
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      startedAtRef.current = performance.now();
      setElapsedSec(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopTimer();
        const durationSec = Math.max(
          0,
          Math.round(((performance.now() - startedAtRef.current) / 1000) * 10) / 10,
        );
        setElapsedSec(durationSec);
        const mimeType = recorder.mimeType || preferredMime || "audio/webm";
        const extension = mimeType.includes("mp4") ? "m4a" : "webm";
        const file = new File(chunksRef.current, `study-recording.${extension}`, {
          type: mimeType,
        });
        stopStream();
        if (file.size === 0) {
          setRecordingState("failed");
          setRecordingError(t("recordingEmpty"));
          return;
        }
        setRecordingState("uploading");
        uploadRecording.mutate({ file, durationSec });
      };
      recorder.start();
      setRecordingState("recording");
      timerRef.current = setInterval(() => {
        setElapsedSec((performance.now() - startedAtRef.current) / 1000);
      }, 250);
    } catch {
      stopTimer();
      stopStream();
      setRecordingState("failed");
      setRecordingError(t("recordingPermissionFailed"));
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  };

  const seekToSegment = (recordingId: string, startSec: number) => {
    const isSameRecording = recordingId === activePlaybackRecordingId;
    setActivePlaybackRecordingId(recordingId);
    pendingSeekRef.current = startSec;

    if (isSameRecording && audioRef.current) {
      audioRef.current.currentTime = startSec;
      void audioRef.current.play().catch(() => undefined);
      pendingSeekRef.current = null;
    }
  };

  return (
    <div className="space-y-3 p-3">
      <p className="text-xs leading-5 text-muted-foreground">
        {t("studyDescription")}
      </p>
      {projectId ? (
        <button
          type="button"
          disabled={createSession.isPending}
          className="app-hover inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border px-2.5 text-sm disabled:opacity-60"
          onClick={() => createSession.mutate()}
        >
          <BookOpen aria-hidden className="h-4 w-4" />
          {createSession.isPending
            ? t("creatingStudySession")
            : t("createStudySession")}
        </button>
      ) : null}
      <div className="rounded-[var(--radius-card)] border border-border bg-muted/25 p-2">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
          <Mic2 aria-hidden className="h-3 w-3" />
          {activeSession ? t("sessionReady") : t("transcriptPending")}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {segments.length > 0
            ? t("transcriptReady", { count: segments.length })
            : hasPendingTranscript
              ? t("transcriptPending")
              : t("noRecording")}
        </p>
      </div>
      <div className="space-y-2 rounded-[var(--radius-card)] border border-border p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">{t("recordingTitle")}</div>
            <div className="text-[11px] text-muted-foreground">
              {recordingState === "recording"
                ? t("recordingDuration", { duration: formatDuration(elapsedSec) })
                : recordingState === "uploading"
                  ? t("recordingUploading")
                  : processingRecordings.length > 0
                    ? t("recordingProcessing")
                    : readyRecordings.length > 0
                      ? t("recordingCompleted", { count: readyRecordings.length })
                      : t("recordingIdle")}
            </div>
          </div>
          {recordingState === "recording" ? (
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-2 text-xs"
              onClick={stopRecording}
            >
              <Square aria-hidden className="h-3.5 w-3.5" />
              {t("stopRecording")}
            </button>
          ) : (
            <button
              type="button"
              disabled={!canRecord || !mediaSupported}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-2 text-xs disabled:opacity-50"
              onClick={() => void startRecording()}
            >
              <Mic2 aria-hidden className="h-3.5 w-3.5" />
              {t("startRecording")}
            </button>
          )}
        </div>
        {!mediaSupported ? (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <AlertCircle aria-hidden className="h-3.5 w-3.5" />
            {t("recordingUnsupported")}
          </p>
        ) : null}
        {recordingError ? (
          <p className="flex items-center gap-1.5 text-[11px] text-destructive">
            <AlertCircle aria-hidden className="h-3.5 w-3.5" />
            {recordingError}
          </p>
        ) : null}
      </div>
      {recordings.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">
            {t("recordingsTitle")}
          </div>
          {recordings.map((recording) => (
            <RecordingRow
              key={recording.id}
              recording={recording}
              sessionId={activeSession!.id}
              active={recording.id === activePlaybackRecording?.id}
              onPlay={() => setActivePlaybackRecordingId(recording.id)}
              t={t}
            />
          ))}
        </div>
      ) : null}
      {activePlaybackRecording ? (
        <div className="space-y-2 rounded-[var(--radius-card)] border border-border p-2">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Play aria-hidden className="h-3.5 w-3.5" />
            {t("playbackTitle")}
          </div>
          <audio
            data-testid="study-recording-audio"
            ref={audioRef}
            controls
            className="w-full"
            src={studySessionsApi.recordingFileUrl(
              activeSession!.id,
              activePlaybackRecording.id,
            )}
            onLoadedMetadata={() => {
              if (pendingSeekRef.current == null || !audioRef.current) return;
              audioRef.current.currentTime = pendingSeekRef.current;
              void audioRef.current.play().catch(() => undefined);
              pendingSeekRef.current = null;
            }}
          />
        </div>
      ) : null}
      <div className="space-y-2 rounded-[var(--radius-card)] border border-border p-2">
        <div className="text-xs font-medium">{t("transcriptTitle")}</div>
        {transcriptQuery.isLoading || processingRecordings.length > 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
            {t("transcriptProcessing")}
          </p>
        ) : failedRecordings.length > 0 && segments.length === 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle aria-hidden className="h-3.5 w-3.5" />
            {t("transcriptFailed")}
          </p>
        ) : segments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("transcriptEmpty")}</p>
        ) : (
          <div className="space-y-1.5">
            {segments.map((segment) => (
              <button
                key={segment.id}
                type="button"
                className="block w-full rounded-[var(--radius-control)] border border-border px-2 py-1.5 text-left hover:bg-muted/50"
                onClick={() => seekToSegment(segment.recordingId, segment.startSec)}
              >
                <span className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                  {formatDuration(segment.startSec)} - {formatDuration(segment.endSec)}
                </span>
                <span className="block text-xs leading-5">{segment.text}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecordingRow({
  recording,
  sessionId,
  active,
  onPlay,
  t,
}: {
  recording: SessionRecording;
  sessionId: string;
  active: boolean;
  onPlay(): void;
  t(key: string, values?: Record<string, string | number>): string;
}) {
  const canPlay = recording.status === "ready";
  return (
    <div className="rounded-[var(--radius-card)] border border-border p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">
            {recording.durationSec != null
              ? t("recordingDuration", {
                  duration: formatDuration(recording.durationSec),
                })
              : t("recordingUnknownDuration")}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {recordingStatusLabel(recording, t)}
          </div>
        </div>
        {canPlay ? (
          <button
            type="button"
            aria-pressed={active}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-control)] border border-border px-2 text-[11px]"
            onClick={onPlay}
          >
            <Play aria-hidden className="h-3 w-3" />
            {active ? t("playing") : t("play")}
          </button>
        ) : null}
      </div>
      {canPlay && active ? (
        <div className="mt-2 h-8 overflow-hidden rounded-[var(--radius-control)] bg-muted/50">
          <div className="flex h-full items-end gap-0.5 px-1 py-1" aria-hidden>
            {Array.from({ length: 24 }).map((_, index) => (
              <span
                key={`${sessionId}-${recording.id}-${index}`}
                className="w-full rounded-sm bg-foreground/50"
                style={{ height: `${24 + ((index * 17) % 58)}%` }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function recordingStatusLabel(
  recording: SessionRecording,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  if (recording.status === "failed" || recording.transcriptStatus === "failed") {
    return t("recordingFailed");
  }
  if (recording.status === "ready" && recording.transcriptStatus === "ready") {
    return t("recordingReady");
  }
  if (recording.status === "processing" || recording.transcriptStatus === "processing") {
    return t("recordingProcessing");
  }
  return t("recordingUploaded");
}

function formatDuration(value: number) {
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
