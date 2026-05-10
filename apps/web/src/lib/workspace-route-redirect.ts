import { redirect } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { requireSession } from "@/lib/session";
import { urls } from "@/lib/urls";

type WorkspaceRoute = "help" | "report";

export async function redirectToWorkspaceRoute(
  locale: string,
  route: WorkspaceRoute,
): Promise<never> {
  await requireSession();
  const workspaces = await apiClient<Array<{ slug: string }>>("/workspaces", {
    cache: "no-store",
  });
  const slug = workspaces[0]?.slug;
  if (!slug) redirect(urls.onboarding(locale));
  redirect(urls.workspace[route](locale, slug));
}
