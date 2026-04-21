import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";

// /app/w/:wsSlug → 첫 프로젝트로 redirect. 프로젝트 없으면 new-project placeholder.
export default async function WorkspaceIndex({
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
  const ws = (await wsRes.json()) as { id: string };

  const projRes = await fetch(`${base}/api/projects?workspaceId=${ws.id}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!projRes.ok) notFound();
  const projects = (await projRes.json()) as Array<{ id: string }>;
  if (projects.length === 0) redirect(`/${locale}/app/w/${wsSlug}/new-project`);
  redirect(`/${locale}/app/w/${wsSlug}/p/${projects[0].id}`);
}
