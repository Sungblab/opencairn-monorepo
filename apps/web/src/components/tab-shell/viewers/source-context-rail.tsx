"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  BookOpen,
  CheckSquare,
  FileSearch,
  ListChecks,
  Loader2,
  Mic2,
  Play,
  Quote,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { NoteUpdateActionReviewList } from "@/components/agent-panel/note-update-action-review";
import { WorkbenchActivityStack } from "@/components/agent-panel/workbench-activity-stack";
import {
  WorkbenchActivityButton,
  WorkbenchCommandButton,
  WorkbenchContextButton,
} from "@/components/agent-panel/workbench-trigger-button";
import { studySessionsApi, type SessionRecording } from "@/lib/api-client";

type SourceRailTab = "analysis" | "study" | "activity";

interface SourceContextRailProps {
  noteId: string;
  projectId: string | null;
  sourceTitle: string;
  viewerElementId: string;
}

export function SourceContextRail({
  noteId,
  projectId,
  sourceTitle,
  viewerElementId,
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
              <SourceRailAnalysis selectedText={selectedText} />
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

function SourceRailAnalysis({ selectedText }: { selectedText: string }) {
  const t = useTranslations("appShell.viewers.source.rail");
  const selectedCount = selectedText.length;

  return (
    <div className="space-y-3 p-3">
      <p className="text-xs leading-5 text-muted-foreground">
        {t("analysisDescription")}
      </p>
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
          {t("useThisPdf")}
        </WorkbenchContextButton>
        <WorkbenchCommandButton
          commandId="summarize"
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
