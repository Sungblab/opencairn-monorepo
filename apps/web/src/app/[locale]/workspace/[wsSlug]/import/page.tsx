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
    <div className="min-h-full bg-background px-8 py-7">
      <div className="max-w-4xl">
        <h1 className="text-2xl font-semibold tracking-normal">
          {t("pageTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("pageDescription")}
        </p>
        <div className="mt-7">
          <ImportTabs wsSlug={wsSlug} />
        </div>
      </div>
    </div>
  );
}
