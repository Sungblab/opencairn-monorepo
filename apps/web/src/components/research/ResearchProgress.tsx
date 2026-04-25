"use client";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { researchApi, researchKeys } from "@/lib/api-client-research";
import type { ResearchArtifact } from "@opencairn/shared";

export interface ResearchProgressProps {
  runId: string;
  artifacts: ResearchArtifact[];
}

function payloadText(payload: Record<string, unknown>): string {
  const t = payload.text;
  return typeof t === "string" ? t : JSON.stringify(payload);
}

function payloadImageUrl(payload: Record<string, unknown>): string | null {
  const u = payload.image_url ?? payload.url;
  return typeof u === "string" ? u : null;
}

export function ResearchProgress({ runId, artifacts }: ResearchProgressProps) {
  const t = useTranslations("research.progress");
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => researchApi.cancel(runId),
    onSuccess: () => qc.invalidateQueries({ queryKey: researchKeys.detail(runId) }),
  });

  const thoughts = artifacts.filter((a) => a.kind === "thought_summary");
  const texts = artifacts.filter((a) => a.kind === "text_delta");
  const images = artifacts.filter((a) => a.kind === "image");

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <header className="mb-4">
        <h2 className="text-xl font-semibold">{t("heading")}</h2>
        <p className="text-muted-foreground text-sm">{t("subhead")}</p>
      </header>

      {artifacts.length === 0 ? (
        <div className="text-muted-foreground rounded border border-dashed border-border p-6 text-sm">
          {t("no_artifacts_yet")}
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          {thoughts.length > 0 && (
            <details>
              <summary className="text-muted-foreground cursor-pointer text-xs">
                {t("thinking")} ({thoughts.length})
              </summary>
              <ul className="mt-1 space-y-1">
                {thoughts.map((a) => (
                  <li key={a.id} className="text-muted-foreground">
                    {payloadText(a.payload)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {texts.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase">{t("writing")}</h3>
              <pre className="whitespace-pre-wrap text-sm">
                {texts.map((a) => payloadText(a.payload)).join("")}
              </pre>
            </section>
          )}
          {images.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase">
                {t("image_generating")}
              </h3>
              {images.map((a) => {
                const url = payloadImageUrl(a.payload);
                return url ? (
                  <img
                    key={a.id}
                    src={url}
                    alt=""
                    className="max-w-full rounded border border-border"
                  />
                ) : null;
              })}
            </section>
          )}
        </div>
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending}
          className="rounded border border-border px-3 py-1 text-sm"
        >
          {cancel.isPending ? t("cancelling") : t("cancel")}
        </button>
      </div>
    </div>
  );
}
