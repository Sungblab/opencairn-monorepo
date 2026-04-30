"use client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  enrichmentResponseSchema,
  enrichmentOutlineItemSchema,
  enrichmentFigureSchema,
  enrichmentTableSchema,
  type EnrichmentResponse,
  type EnrichmentOutlineItem,
  type EnrichmentFigure,
  type EnrichmentTable,
} from "@opencairn/shared";

interface Props {
  noteId: string;
}

// `artifact` is wire-typed as Record<string,unknown> because the worker may
// add type-specific keys (slides, chapter_tree, sections, …) over time. We
// runtime-validate just the slices the panel renders, so additions are
// forward-compatible without a shared-package change.
function pickArray<T>(
  value: unknown,
  itemSchema: { safeParse(input: unknown): { success: boolean; data?: T } },
): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const r = itemSchema.safeParse(item);
    if (r.success && r.data !== undefined) out.push(r.data);
  }
  return out;
}

export function EnrichmentPanel({ noteId }: Props) {
  const t = useTranslations("note.enrichment");

  const { data, status, error } = useQuery<EnrichmentResponse | null>({
    queryKey: ["enrichment", noteId],
    enabled: !!noteId,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/notes/${noteId}/enrichment`);
      // 404 is a normal "no artifact" state, not an error.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`enrichment ${res.status}`);
      const raw = await res.json();
      const parsed = enrichmentResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("enrichment_payload_invalid");
      }
      return parsed.data;
    },
  });

  return (
    <aside
      data-testid="enrichment-panel"
      aria-label={t("toggleAria")}
      className="flex h-full w-72 flex-col gap-3 overflow-y-auto border-l border-border bg-background p-3"
    >
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        {data ? (
          <span className="text-[11px] text-muted-foreground">
            <ContentTypeLabel contentType={data.contentType} />
          </span>
        ) : null}
      </header>

      {status === "pending" ? (
        <p className="text-xs text-muted-foreground">{t("loading")}</p>
      ) : null}

      {status === "error" ? (
        <p className="text-xs text-destructive">
          {t("loadError", { msg: (error as Error)?.message ?? "" })}
        </p>
      ) : null}

      {status === "success" && !data ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : null}

      {status === "success" && data ? (
        <ArtifactBody data={data} />
      ) : null}
    </aside>
  );
}

function ArtifactBody({ data }: { data: EnrichmentResponse }) {
  const t = useTranslations("note.enrichment");
  const artifact = data.artifact ?? {};
  const outline = pickArray<EnrichmentOutlineItem>(
    (artifact as Record<string, unknown>).outline,
    enrichmentOutlineItemSchema,
  );
  const figures = pickArray<EnrichmentFigure>(
    (artifact as Record<string, unknown>).figures,
    enrichmentFigureSchema,
  );
  const tables = pickArray<EnrichmentTable>(
    (artifact as Record<string, unknown>).tables,
    enrichmentTableSchema,
  );
  const wordCount = (artifact as Record<string, unknown>).word_count;

  return (
    <div className="flex flex-col gap-3">
      <StatusRow status={data.status} />

      {data.status === "failed" && data.error ? (
        <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          {data.error}
        </p>
      ) : null}

      {data.skipReasons.length > 0 ? (
        <section>
          <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("skipReasons")}
          </h4>
          <ul className="flex flex-col gap-0.5 text-xs">
            {data.skipReasons.map((r) => (
              <li
                key={r}
                className="text-muted-foreground"
                data-testid="enrichment-skip-reason"
              >
                {r}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {outline.length > 0 ? (
        <section>
          <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("outline")}
          </h4>
          <ul className="flex flex-col gap-0.5">
            {outline.map((item, i) => (
              <li
                key={`${item.title}-${i}`}
                className="truncate text-xs"
                style={{ paddingLeft: `${(item.level - 1) * 8}px` }}
              >
                <span className="text-foreground">{item.title}</span>
                {typeof item.page === "number" ? (
                  <span className="ml-2 text-muted-foreground">
                    {t("pageRef", { page: item.page })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {figures.length > 0 ? (
        <section>
          <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("figures", { count: figures.length })}
          </h4>
          <ul className="flex flex-col gap-1 text-xs">
            {figures.slice(0, 8).map((f, i) => (
              <li
                key={i}
                className="truncate text-muted-foreground"
                title={f.caption}
              >
                {f.caption ?? t("untitled")}
                {typeof f.page === "number"
                  ? ` · ${t("pageRef", { page: f.page })}`
                  : ""}
              </li>
            ))}
            {figures.length > 8 ? (
              <li className="text-[11px] text-muted-foreground">
                {t("moreCount", { count: figures.length - 8 })}
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {tables.length > 0 ? (
        <section>
          <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("tables", { count: tables.length })}
          </h4>
          <ul className="flex flex-col gap-1 text-xs">
            {tables.slice(0, 6).map((tbl, i) => (
              <li
                key={i}
                className="truncate text-muted-foreground"
                title={tbl.caption}
              >
                {tbl.caption ?? t("untitled")}
                {typeof tbl.page === "number"
                  ? ` · ${t("pageRef", { page: tbl.page })}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {typeof wordCount === "number" ? (
        <p className="text-[11px] text-muted-foreground">
          {t("wordCount", { count: wordCount })}
        </p>
      ) : null}

      {data.provider ? (
        <p className="text-[11px] text-muted-foreground">
          {t("provider", { provider: data.provider })}
        </p>
      ) : null}
    </div>
  );
}

// Spec B's seven content types are a closed enum (worker spec §5). Anything
// else (defensive: e.g. a future addition or wire corruption) renders the
// raw value rather than a translation key — the panel stays useful while
// the i18n catches up.
const KNOWN_CONTENT_TYPES = [
  "document",
  "paper",
  "slide",
  "book",
  "code",
  "table",
  "image",
] as const;
type KnownContentType = (typeof KNOWN_CONTENT_TYPES)[number];
function isKnownContentType(v: string): v is KnownContentType {
  return (KNOWN_CONTENT_TYPES as readonly string[]).includes(v);
}
function ContentTypeLabel({ contentType }: { contentType: string }) {
  const t = useTranslations("note.enrichment.contentType");
  if (isKnownContentType(contentType)) {
    return <>{t(contentType)}</>;
  }
  return <>{contentType}</>;
}

function StatusRow({ status }: { status: EnrichmentResponse["status"] }) {
  const t = useTranslations("note.enrichment.status");
  const variant: "ok" | "warn" | "danger" =
    status === "done" ? "ok" : status === "failed" ? "danger" : "warn";
  const palette: Record<typeof variant, string> = {
    ok: "border-success/40 text-success bg-success/5",
    warn: "border-border text-muted-foreground bg-surface",
    danger: "border-destructive/40 text-destructive bg-destructive/5",
  };
  return (
    <div
      data-testid={`enrichment-status-${status}`}
      className={`inline-flex w-fit items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium ${palette[variant]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${variant === "ok" ? "bg-success" : variant === "danger" ? "bg-destructive" : "bg-muted-foreground"}`}
        aria-hidden="true"
      />
      {t(status)}
    </div>
  );
}
