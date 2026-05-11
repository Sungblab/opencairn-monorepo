import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { IngestEvent } from "@opencairn/shared";

export type FigureItem = {
  objectKey: string;
  figureKind: "image" | "table" | "chart" | "equation";
  caption: string | null;
  width: number | null;
  height: number | null;
  sourceUnit: number;
};

export type OutlineNode = {
  id: string;
  parentId: string | null;
  level: number;
  title: string;
};

export type IngestRunState = {
  workflowId: string;
  fileName: string | null;
  mime: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  lastSeq: number;
  units: { current: number; total: number | null };
  stage: "downloading" | "parsing" | "enhancing" | "persisting" | null;
  figures: FigureItem[];
  artifacts: {
    nodeId: string;
    parentId: string | null;
    kind: "note" | "agent_file" | "artifact" | "artifact_group";
    label: string;
    role: string;
    pageIndex?: number;
    figureIndex?: number;
  }[];
  bundleNodeId: string | null;
  bundleStatus: "running" | "completed" | "failed" | null;
  outline: OutlineNode[];
  error: { reason: string; retryable: boolean } | null;
  noteId: string | null;
};

type IngestStore = {
  runs: Record<string, IngestRunState>;
  spotlightWfid: string | null;
  startRun(
    wfid: string,
    mime: string,
    fileName: string | null,
    opts?: { sourceBundleNodeId?: string | null },
  ): void;
  applyEvent(wfid: string, ev: IngestEvent): void;
  setSpotlight(wfid: string | null): void;
  dismissDockCard(wfid: string): void;
};

function emptyRun(
  wfid: string,
  mime: string,
  fileName: string | null,
): IngestRunState {
  return {
    workflowId: wfid,
    fileName,
    mime,
    status: "running",
    startedAt: Date.now(),
    lastSeq: 0,
    units: { current: 0, total: null },
    stage: null,
    figures: [],
    artifacts: [],
    bundleNodeId: null,
    bundleStatus: null,
    outline: [],
    error: null,
    noteId: null,
  };
}

export const useIngestStore = create<IngestStore>()(
  persist(
    (set) => ({
      runs: {},
      spotlightWfid: null,
      startRun: (wfid, mime, fileName, opts) =>
        set((s) => {
          // Spotlight only when no other run started in the last 200ms — that
          // window is the multi-file dispatch heuristic from spec §11. Once a
          // batch is detected the dock alone shows progress for all files.
          const now = Date.now();
          const recentStart = Object.values(s.runs).some(
            (r) => now - r.startedAt < 200 && r.status === "running",
          );
          const run = emptyRun(wfid, mime, fileName);
          if (opts?.sourceBundleNodeId) {
            run.bundleNodeId = opts.sourceBundleNodeId;
            run.bundleStatus = "running";
          }
          return {
            runs: { ...s.runs, [wfid]: run },
            spotlightWfid: recentStart ? s.spotlightWfid : wfid,
          };
        }),
      applyEvent: (wfid, ev) =>
        set((s) => {
          const run = s.runs[wfid];
          if (!run) return s;
          const isTerminalEvent =
            ev.kind === "completed" || ev.kind === "failed";
          if (run.status !== "running" && !isTerminalEvent) return s;
          if (
            ev.seq <= run.lastSeq &&
            !(isTerminalEvent && run.status === "running")
          ) {
            return s;
          }
          const next: IngestRunState = { ...run, lastSeq: ev.seq };
          switch (ev.kind) {
            case "started":
              next.units = { current: 0, total: ev.payload.totalUnits };
              if (ev.payload.fileName) next.fileName = ev.payload.fileName;
              break;
            case "stage_changed":
              next.stage = ev.payload.stage;
              break;
            case "unit_started":
              next.units = {
                current: ev.payload.index,
                total: ev.payload.total,
              };
              break;
            case "unit_parsed":
              next.units = {
                current: ev.payload.index + 1,
                total: run.units.total,
              };
              break;
            case "figure_extracted":
              next.figures = [
                ...run.figures,
                {
                  objectKey: ev.payload.objectKey,
                  figureKind: ev.payload.figureKind,
                  caption: ev.payload.caption,
                  width: ev.payload.width,
                  height: ev.payload.height,
                  sourceUnit: ev.payload.sourceUnit,
                },
              ];
              break;
            case "artifact_created":
              next.artifacts = [...run.artifacts, ev.payload];
              break;
            case "bundle_status_changed":
              next.bundleNodeId = ev.payload.bundleNodeId;
              next.bundleStatus = ev.payload.status;
              break;
            case "outline_node":
              next.outline = [
                ...run.outline,
                {
                  id: ev.payload.id,
                  parentId: ev.payload.parentId,
                  level: ev.payload.level,
                  title: ev.payload.title,
                },
              ];
              break;
            case "completed":
              next.status = "completed";
              next.noteId = ev.payload.noteId;
              if (next.bundleStatus === "running") {
                next.bundleStatus = "completed";
              }
              break;
            case "failed":
              next.status = "failed";
              next.error = {
                reason: ev.payload.reason,
                retryable: ev.payload.retryable,
              };
              if (next.bundleStatus === "running") {
                next.bundleStatus = "failed";
              }
              break;
            case "enrichment":
              // Spec B will fill enrichment widgets; ignored at store level.
              break;
          }
          return { runs: { ...s.runs, [wfid]: next } };
        }),
      setSpotlight: (wfid) => set({ spotlightWfid: wfid }),
      dismissDockCard: (wfid) =>
        set((s) => {
          const { [wfid]: _dropped, ...rest } = s.runs;
          return { runs: rest };
        }),
    }),
    {
      name: "ingest-store",
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? { getItem: () => null, setItem: () => {}, removeItem: () => {} }
          : window.localStorage,
      ),
      // Only persist still-running runs and trim arrays so localStorage
      // never grows unbounded across sessions.
      partialize: (s) => ({
        runs: Object.fromEntries(
          Object.entries(s.runs)
            .filter(([, r]) => r.status === "running")
            .map(([k, r]) => [
              k,
              {
                ...r,
                figures: r.figures.slice(-20),
                outline: r.outline.slice(-100),
              },
            ]),
        ),
        spotlightWfid: s.spotlightWfid,
      }),
    },
  ),
);
