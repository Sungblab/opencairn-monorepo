"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PlateElementProps } from "platejs/react";

import { safeHref } from "@/lib/url/safe-href";
import {
  isResearchMetaElement,
  type ResearchMetaElement as ResearchMetaElementType,
  type ResearchMetaModel,
} from "./research-meta-types";

const MODEL_LABEL: Record<ResearchMetaModel, string> = {
  "deep-research-preview-04-2026": "Deep Research",
  "deep-research-max-preview-04-2026": "Deep Research Max",
};

function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Void Plate v49 element. Worker-only producer (slash menu unregistered).
// Follows the same render contract as math-block.tsx: spread `attributes` on
// the outer div, set `data-slate-void="true"`, render `children` once, keep
// the body `contentEditable={false}` so Slate doesn't try to place a
// selection inside the metadata UI.
//
// Do NOT use `<PlateElement>` wrapper here — its typing rejects
// `contentEditable` and the codebase convention is the plain
// `<div {...attributes}>` form (see math-block.tsx).
export function ResearchMetaElement({
  attributes,
  children,
  element,
}: PlateElementProps) {
  const t = useTranslations("research.meta");
  const [open, setOpen] = useState(false);

  if (!isResearchMetaElement(element)) {
    // Defensive: foreign node type must not crash the editor. Maintain void
    // contract by rendering children once.
    return (
      <div {...attributes} contentEditable={false} data-slate-void="true">
        {children}
      </div>
    );
  }

  const meta: ResearchMetaElementType = element;
  const hasCost = typeof meta.costUsdCents === "number";
  const hasThoughts =
    Array.isArray(meta.thoughtSummaries) &&
    meta.thoughtSummaries.length > 0;

  return (
    <div
      {...attributes}
      contentEditable={false}
      data-slate-void="true"
      className="my-3 rounded border border-border bg-muted/30 p-3 text-sm"
    >
      <div data-testid="research-meta-block">
        <div className="flex items-center justify-between">
          <span className="font-medium">{t("label")}</span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            {open ? t("collapse") : t("expand")}
          </button>
        </div>
        <div className="text-muted-foreground mt-1 text-xs">
          {t("model_label")}: {MODEL_LABEL[meta.model]}
        </div>
        {open && (
          <div className="mt-2 space-y-3">
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide">
                {t("plan")}
              </h4>
              <pre className="whitespace-pre-wrap text-xs">{meta.plan}</pre>
            </section>
            {meta.sources.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide">
                  {t("sources")}
                </h4>
                <ol className="ml-4 list-decimal text-xs">
                  {meta.sources.map((s) => (
                    <li key={s.seq}>
                      {/* s.url originates from Deep Research / Gemini
                          grounding output — i.e. URLs scraped from arbitrary
                          web pages. Run through safeHref so `javascript:` /
                          `data:` URIs cannot execute on click. */}
                      <a
                        href={safeHref(s.url)}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="underline"
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {hasThoughts && (
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide">
                  {t("thought_summaries")}
                </h4>
                <ul className="ml-4 list-disc text-xs">
                  {meta.thoughtSummaries!.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </section>
            )}
            {hasCost && (
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide">
                  {t("cost_approx")}
                </h4>
                <p className="text-xs">
                  {formatUsdCents(meta.costUsdCents!)}
                  <span className="text-muted-foreground ml-2">
                    {t("cost_disclaimer")}
                  </span>
                </p>
              </section>
            )}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
