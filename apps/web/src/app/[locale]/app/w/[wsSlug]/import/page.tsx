import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ImportTabs } from "./ImportTabs";

// Import feature is behind FEATURE_IMPORT_ENABLED so the route is a 404
// until an admin explicitly turns it on. Keeps the surface narrow during
// the multi-plan rollout.
export default async function ImportPage({
  params,
}: {
  params: Promise<{ locale: string; wsSlug: string }>;
}) {
  if (process.env.FEATURE_IMPORT_ENABLED !== "true") {
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
