import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function LearnHubPage({
  params,
}: {
  params: Promise<{ wsSlug: string; projectId: string }>;
}) {
  const { wsSlug, projectId } = await params;
  const t = await getTranslations("learn.hub");

  const sections = [
    {
      href: `/app/w/${wsSlug}/p/${projectId}/learn/flashcards`,
      titleKey: "flashcards.title" as const,
      descKey: "flashcards.description" as const,
    },
    {
      href: `/app/w/${wsSlug}/p/${projectId}/learn/scores`,
      titleKey: "scores.title" as const,
      descKey: "scores.description" as const,
    },
  ];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">{t("title")}</h1>
      <p className="text-muted-foreground mb-8">{t("subtitle")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-xl border border-border bg-card p-5 hover:shadow-md transition-shadow flex flex-col gap-2"
          >
            <span className="font-semibold text-card-foreground">
              {t(s.titleKey)}
            </span>
            <span className="text-sm text-muted-foreground">
              {t(s.descKey)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
