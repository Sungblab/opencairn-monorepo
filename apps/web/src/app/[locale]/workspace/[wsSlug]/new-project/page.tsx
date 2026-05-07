import { urls } from "@/lib/urls";
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { DEFAULT_PROJECT_NAME } from "@opencairn/shared";

// Fallback for the rare case where a workspace has zero projects
// (e.g. user deleted them all). Auto-creates a default project and
// redirects into it — no UI prompt, matches the "one-click into editing"
// onboarding principle.
export default async function NewProject({
  params,
}: {
  params: Promise<{ locale: string; wsSlug: string }>;
}) {
  const { locale, wsSlug } = await params;
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

  const wsRes = await fetch(`${base}/api/workspaces/by-slug/${wsSlug}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!wsRes.ok) notFound();
  const ws = (await wsRes.json()) as { id: string; name: string };

  const createRes = await fetch(`${base}/api/workspaces/${ws.id}/projects`, {
    method: "POST",
    headers: { cookie: cookieHeader, "content-type": "application/json" },
    body: JSON.stringify({ name: DEFAULT_PROJECT_NAME }),
    cache: "no-store",
  });
  if (!createRes.ok) notFound();
  const project = (await createRes.json()) as { id: string };
  redirect(urls.workspace.project(locale, wsSlug, project.id));
}
