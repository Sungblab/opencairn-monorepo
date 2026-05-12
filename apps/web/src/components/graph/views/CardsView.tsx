"use client";
import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { urls } from "@/lib/urls";
import { useProjectGraph } from "../useProjectGraph";
import { evidenceBundleById } from "../grounded-types";
import { ConceptCard } from "./ConceptCard";

interface Props {
  projectId: string;
}

/**
 * `?view=cards` — readable concept cards. This view is intentionally not a
 * canvas graph: cards are for scanning summaries, opening source notes, and
 * jumping into study/question flows without label collisions.
 */
export default function CardsView({ projectId }: Props) {
  const t = useTranslations("graph");
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ wsSlug?: string }>();
  const wsSlug = params?.wsSlug;
  const { data, isLoading, error } = useProjectGraph(projectId, {
    view: "cards",
  });

  const cardsByConceptId = useMemo(() => {
    return new Map((data?.cards ?? []).map((card) => [card.conceptId, card]));
  }, [data]);
  const bundlesById = useMemo(
    () => evidenceBundleById(data?.evidenceBundles),
    [data?.evidenceBundles],
  );

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">…</div>;
  }
  if (error) {
    return (
      <div className="p-6 text-sm text-destructive">
        {t("errors.loadFailed")}
      </div>
    );
  }
  if (!data || data.nodes.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("views.noConcepts")}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t("cards.title")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("cards.description", { count: data.nodes.length })}
          </p>
        </div>
        {data.truncated ? (
          <span className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">
            {t("cards.truncated", {
              shown: data.nodes.length,
              total: data.totalConcepts,
            })}
          </span>
        ) : null}
      </div>
      <div
        data-testid="concept-card-grid"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {data.nodes.map((node) => {
          const card = cardsByConceptId.get(node.id);
          const bundle = card?.evidenceBundleId
            ? bundlesById.get(card.evidenceBundleId)
            : undefined;
          return (
            <ConceptCard
              key={node.id}
              node={node}
              card={card}
              bundle={bundle}
              onAsk={() => {
                if (!wsSlug) return;
                router.push(
                  `${urls.workspace.projectLearnSocratic(locale, wsSlug, projectId)}?concept=${encodeURIComponent(card?.title ?? node.name)}`,
                );
              }}
              onQuiz={() => {
                if (!wsSlug) return;
                router.push(urls.workspace.projectLearnFlashcards(locale, wsSlug, projectId));
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
