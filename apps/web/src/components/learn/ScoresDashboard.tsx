"use client";

import { useTranslations, useFormatter } from "next-intl";

type ScoreEntry = {
  conceptId: string;
  conceptTitle?: string;
  score: number;
  lastAssessed: string;
};

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 80
      ? "bg-green-500"
      : score >= 50
        ? "bg-yellow-500"
        : "bg-destructive";
  return (
    <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

export function ScoresDashboard({ scores }: { scores: ScoreEntry[] }) {
  const t = useTranslations("learn.scores");
  const format = useFormatter();

  if (scores.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{t("empty")}</p>
    );
  }

  const sorted = [...scores].sort((a, b) => a.score - b.score);

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((entry) => (
        <div
          key={entry.conceptId}
          className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm text-card-foreground">
              {entry.conceptTitle ?? entry.conceptId}
            </span>
            <span
              className={`text-sm font-bold tabular-nums ${
                entry.score >= 80
                  ? "text-green-600"
                  : entry.score >= 50
                    ? "text-yellow-600"
                    : "text-destructive"
              }`}
            >
              {Math.round(entry.score)}%
            </span>
          </div>
          <ScoreBar score={entry.score} />
          <p className="text-xs text-muted-foreground">
            {t("last_reviewed")}:{" "}
            {format.dateTime(new Date(entry.lastAssessed), {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      ))}
    </div>
  );
}
