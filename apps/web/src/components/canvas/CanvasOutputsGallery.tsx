"use client";

// Plan 7 Canvas Phase 2 — outputs gallery + Save button.
//
// Two layers of figures:
//   1. `pendingFigures` — base64 PNGs forwarded by the python CanvasFrame
//      (CANVAS_PYTHON_RESULT message) from the most recent run. These are
//      not persisted yet; we render them with a Save button that POSTs the
//      bytes via `useCanvasOutputs.upload`.
//   2. `data.outputs` — already-saved outputs returned by the GET list. The
//      server gives us `urlPath` (S3 presigned proxy), so we render
//      `<img src={urlPath}>` directly.
//
// Empty state is intentionally shown only when BOTH pending and saved are
// empty — once the user has run code that produced figures, we want them to
// see the previews even if they haven't saved yet.

import { useTranslations } from "next-intl";
import { useCanvasOutputs } from "@/lib/use-canvas-outputs";

type Props = {
  noteId: string;
  runId: string | null;
  pendingFigures: string[];
};

// Convert base64 PNG → Blob for the multipart upload. `atob` returns binary
// chars; we walk it byte-by-byte into a Uint8Array.
function base64ToPngBlob(b64: string): Blob {
  const bytes = atob(b64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: "image/png" });
}

export function CanvasOutputsGallery({
  noteId,
  runId,
  pendingFigures,
}: Props) {
  const t = useTranslations("canvas");
  const { data, upload, uploading } = useCanvasOutputs(noteId);
  const saved = data?.outputs ?? [];
  const isEmpty = saved.length === 0 && pendingFigures.length === 0;

  async function handleSave(b64: string) {
    const blob = base64ToPngBlob(b64);
    await upload({ blob, runId: runId ?? undefined });
  }

  return (
    <div
      className="rounded-xl border bg-background p-3 space-y-2"
      data-testid="canvas-outputs-gallery"
    >
      <div className="text-sm font-medium">{t("outputs.title")}</div>

      {isEmpty ? (
        <div
          className="text-xs text-muted-foreground"
          data-testid="outputs-empty"
        >
          {t("outputs.empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {pendingFigures.length > 0 && (
            <div className="space-y-2">
              {pendingFigures.map((b64, i) => (
                <div key={i} className="flex items-start gap-2">
                  <img
                    src={`data:image/png;base64,${b64}`}
                    alt=""
                    className="max-w-full rounded border"
                    data-testid="pending-figure"
                  />
                  <button
                    type="button"
                    onClick={() => handleSave(b64)}
                    disabled={uploading}
                    className="px-3 py-1 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
                    data-testid="output-save"
                  >
                    {t("outputs.save")}
                  </button>
                </div>
              ))}
            </div>
          )}

          {saved.length > 0 && (
            <div className="grid grid-cols-2 gap-2" data-testid="saved-outputs">
              {saved.map((o) => (
                <img
                  key={o.id}
                  src={o.urlPath}
                  alt=""
                  className="max-w-full rounded border"
                  data-testid="saved-output"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
