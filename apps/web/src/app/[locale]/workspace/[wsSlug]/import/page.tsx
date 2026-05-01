import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isImportEnabled } from "@/lib/feature-flags";
import { ImportTabs } from "./ImportTabs";

// Import is production-ready by default, but operators can still hide it with
// FEATURE_IMPORT_ENABLED=false for hosted rollout control.
export default async function ImportPage({
  params,
}: {
  params: Promise<{ locale: string; wsSlug: string }>;
}) {
  if (!isImportEnabled()) {
    notFound();
  }
  const { wsSlug } = await params;
  const t = await getTranslations("import");
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
      <p className="mt-1 text-muted-foreground">{t("pageDescription")}</p>
      <ImportTabs wsSlug={wsSlug} />
    </div>
  );
}
