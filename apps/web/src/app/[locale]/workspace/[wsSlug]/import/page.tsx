import { redirect } from "next/navigation";
import { urls } from "@/lib/urls";

// Import is production-ready by default, but operators can still hide it with
// FEATURE_IMPORT_ENABLED=false for hosted rollout control.
export default async function ImportPage({
  params,
}: {
  params: Promise<{ locale: string; wsSlug: string }>;
}) {
  const { locale, wsSlug } = await params;
  redirect(urls.workspace.root(locale, wsSlug));
}
