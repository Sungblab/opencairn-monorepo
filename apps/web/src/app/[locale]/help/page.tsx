import type { Locale } from "@/i18n";
import { redirectToWorkspaceRoute } from "@/lib/workspace-route-redirect";

export default async function HelpPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  await redirectToWorkspaceRoute(locale, "help");
}
