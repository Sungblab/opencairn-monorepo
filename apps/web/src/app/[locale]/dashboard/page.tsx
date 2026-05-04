import { redirect } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { urls } from "@/lib/urls";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const workspaces = await apiClient<Array<{ slug: string }>>("/workspaces", {
    cache: "no-store",
  });

  if (workspaces[0]?.slug) {
    redirect(urls.workspace.root(locale, workspaces[0].slug));
  }

  redirect(urls.onboarding(locale));
}
