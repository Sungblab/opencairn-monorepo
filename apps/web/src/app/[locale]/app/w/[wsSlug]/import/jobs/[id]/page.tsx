import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { JobProgress } from "./JobProgress";

export default async function JobPage({
  params,
}: {
  params: Promise<{ locale: string; wsSlug: string; id: string }>;
}) {
  if (process.env.FEATURE_IMPORT_ENABLED !== "true") notFound();
  const { wsSlug, id } = await params;
  const t = await getTranslations("import.progress");
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <JobProgress wsSlug={wsSlug} jobId={id} />
    </div>
  );
}
