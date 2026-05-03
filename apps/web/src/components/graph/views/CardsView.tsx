"use client";
import { useTranslations } from "next-intl";
import { useProjectGraph } from "../useProjectGraph";
import { evidenceBundleById } from "../grounded-types";
import { ConceptCard } from "./ConceptCard";

interface Props {
  projectId: string;
}

/**
 * `?view=cards` — pure React/Tailwind grid of concept cards. No cytoscape:
 * Task 9's API contract returns `view=cards` with `edges: []`, so there's
 * nothing to lay out as a graph. Each card opens the concept's first source
 * note in a preview tab (see ConceptCard).
 */
export default function CardsView({ projectId }: Props) {
  const t = useTranslations("graph");
  const { data, isLoading, error } = useProjectGraph(projectId, {
    view: "cards",
  });

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

  const bundles = evidenceBundleById(data.evidenceBundles);
  const cardsByConceptId = new Map(
    (data.cards ?? []).map((card) => [card.conceptId, card]),
  );

  return (
    <div className="grid grid-cols-2 gap-4 overflow-y-auto p-4 lg:grid-cols-3 xl:grid-cols-4">
      {data.nodes.map((n) => {
        const card = cardsByConceptId.get(n.id);
        const bundle = card?.evidenceBundleId
          ? bundles.get(card.evidenceBundleId)
          : undefined;
        return (
          <ConceptCard key={n.id} node={n} card={card} bundle={bundle} />
        );
      })}
    </div>
  );
}
