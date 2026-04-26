"use client";
import { useEffect, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { MAX_CANVAS_SOURCE_BYTES } from "@opencairn/shared";
import { apiClient } from "@/lib/api-client";
import type { Tab } from "@/stores/tabs-store";
import { PyodideRunner } from "@/components/canvas/PyodideRunner";
import { CanvasFrame } from "@/components/canvas/CanvasFrame";
import { MonacoEditor } from "@/components/canvas/MonacoEditor";
import { CodeAgentPanel } from "@/components/canvas/CodeAgentPanel";
import { CanvasOutputsGallery } from "@/components/canvas/CanvasOutputsGallery";
import { useCodeAgentStream } from "@/lib/use-code-agent-stream";

type CanvasLanguage = "python" | "javascript" | "html" | "react";

type CanvasNote = {
  id: string;
  title: string;
  contentText: string;
  canvasLanguage: CanvasLanguage;
  sourceType: "canvas";
};

const SAVE_DEBOUNCE_MS = 1500;

export function CanvasViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("canvas");
  const noteId = tab.targetId;

  const { data: note } = useQuery<CanvasNote>({
    queryKey: ["note", noteId],
    enabled: !!noteId,
    queryFn: () => apiClient<CanvasNote>(`/notes/${noteId}`),
  });

  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: { source: string; language?: CanvasLanguage }) =>
      apiClient<CanvasNote>(`/notes/${noteId}/canvas`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => qc.setQueryData(["note", noteId], data),
  });

  const [source, setSource] = useState("");
  const [language, setLanguage] = useState<CanvasLanguage>("python");
  const [runId, setRunId] = useState(0);
  const [saveStatus, setSaveStatus] = useState<
    "saved" | "saving" | "dirty" | "error"
  >("saved");

  // Plan 7 Canvas Phase 2 — Code Agent + outputs wiring.
  // `currentRunId` is the SSE handle returned by `POST /api/code/run`; it
  // drives `useCodeAgentStream` and is forwarded to the outputs gallery so
  // saved figures get attributed to the right run.
  // `pendingFigures` is the latest set of base64 PNGs harvested from
  // `PyodideRunner.onResult`; the gallery renders them with a Save button.
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [pendingFigures, setPendingFigures] = useState<string[]>([]);
  const runResult = useCodeAgentStream(currentRunId);

  // Sync local state ONLY when we load a different note.
  // Without the id-guard, every successful save (which calls
  // `qc.setQueryData(["note", noteId], data)`) would re-fire this effect
  // and overwrite local edits the user typed during the 1.5s debounce or
  // the in-flight PATCH — losing their latest keystrokes.
  const lastSyncedNoteId = useRef<string | null>(null);
  useEffect(() => {
    if (!note) return;
    if (lastSyncedNoteId.current === note.id) return;
    lastSyncedNoteId.current = note.id;
    setSource(note.contentText ?? "");
    setLanguage(note.canvasLanguage);
  }, [note]);

  // Debounced save. Cancels prior timer on every (source/language) change so
  // bursts collapse into one PATCH 1.5s after the last keystroke.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!note) return;
    if (source === note.contentText && language === note.canvasLanguage) {
      setSaveStatus("saved");
      return;
    }
    setSaveStatus("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveStatus("saving");
      save.mutate(
        { source, language },
        {
          onSuccess: () => setSaveStatus("saved"),
          onError: () => setSaveStatus("error"),
        },
      );
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // `save` mutation object identity is stable per QueryClient; intentionally
    // omitted to avoid restarting the debounce on every render.
  }, [source, language, note]);

  if (!note || !noteId)
    return <div className="p-4 text-sm">{t("frame.loading")}</div>;

  const tooLarge =
    new TextEncoder().encode(source).byteLength > MAX_CANVAS_SOURCE_BYTES;

  // Apply: replace the editor source. Discard from CodeAgentPanel passes
  // the empty string — only treat non-empty payloads as accept.
  function handleAgentApply(applied: string) {
    if (applied.length > 0) setSource(applied);
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="border-b p-2 flex items-center gap-3 text-sm"
        data-testid="canvas-viewer-toolbar"
      >
        <label className="flex items-center gap-2">
          <span>{t("viewer.languageLabel")}:</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as CanvasLanguage)}
            className="border rounded px-2 py-1"
          >
            <option value="python">{t("viewer.languages.python")}</option>
            <option value="javascript">
              {t("viewer.languages.javascript")}
            </option>
            <option value="html">{t("viewer.languages.html")}</option>
            <option value="react">{t("viewer.languages.react")}</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            // Each Run starts a new local run cycle — clear pending figures
            // so stale ones from the previous run don't bleed into the gallery.
            setPendingFigures([]);
            setRunId((n) => n + 1);
          }}
          disabled={tooLarge}
          className="px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50"
        >
          {t("viewer.run")}
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          {saveStatus === "saved" && t("viewer.save.saved")}
          {saveStatus === "saving" && t("viewer.save.saving")}
          {saveStatus === "dirty" && `● ${t("viewer.save.dirty")}`}
          {saveStatus === "error" && t("viewer.save.error")}
        </span>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 border-r min-w-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <MonacoEditor
              language={language}
              value={source}
              onChange={setSource}
            />
          </div>
          <div className="border-t p-2">
            <CodeAgentPanel
              noteId={noteId}
              language={language}
              runResult={
                currentRunId
                  ? {
                      status: runResult.status,
                      turns: runResult.turns,
                      doneStatus: runResult.doneStatus ?? undefined,
                      errorCode: runResult.errorCode ?? undefined,
                    }
                  : null
              }
              onApply={handleAgentApply}
              onStart={(id) => setCurrentRunId(id)}
            />
          </div>
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 p-3 overflow-auto">
            {tooLarge ? (
              <div className="text-destructive text-sm">
                {t("errors.sourceTooLarge")}
              </div>
            ) : language === "python" ? (
              <PyodideRunner
                key={runId}
                source={source}
                onResult={(r) => setPendingFigures(r.figures)}
              />
            ) : (
              <CanvasFrame key={runId} source={source} language={language} />
            )}
          </div>
          <div className="border-t p-2">
            <CanvasOutputsGallery
              noteId={noteId}
              runId={currentRunId}
              pendingFigures={pendingFigures}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
