import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isImportEnabled } from "@/lib/feature-flags";
import { JobProgressLoader } from "./JobProgressLoader";

export default async function JobPage({
  params,
}: {
  params: Promise<{ locale: string; wsSlug: string; id: string }>;
}) {
  if (!isImportEnabled()) notFound();
  const { wsSlug, id } = await params;
  const t = await getTranslations("import.progress");
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <JobProgressLoader wsSlug={wsSlug} jobId={id} />
    </div>
  );
}
