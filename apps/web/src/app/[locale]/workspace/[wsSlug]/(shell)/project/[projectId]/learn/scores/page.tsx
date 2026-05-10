import { getTranslations } from "next-intl/server";
import { apiClient } from "@/lib/api-client";
import { ScoresDashboardLoader } from "@/components/learn/ScoresDashboardLoader";

interface ScoreEntry {
  conceptId: string;
  conceptTitle?: string;
  score: number;
  lastAssessed: string;
}

async function getScores(projectId: string): Promise<ScoreEntry[]> {
  try {
    return await apiClient<ScoreEntry[]>(
      `/api/projects/${projectId}/learn/scores`,
    );
  } catch {
    return [];
  }
}

export default async function ScoresPage({
  params,
}: {
  params: Promise<{ wsSlug: string; projectId: string }>;
}) {
  const { projectId } = await params;
  const t = await getTranslations("learn.scores");
  const scores = await getScores(projectId);

  const avgScore =
    scores.length > 0
      ? Math.round(
          scores.reduce((s, e) => s + e.score, 0) / scores.length,
        )
      : null;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {avgScore !== null && (
          <div className="text-right">
            <p className="text-3xl font-bold text-primary">{avgScore}%</p>
            <p className="text-xs text-muted-foreground">
              {t("avg_label")} · {scores.length} {t("concepts_suffix")}
            </p>
          </div>
        )}
      </div>
      <ScoresDashboardLoader scores={scores} />
    </div>
  );
}
