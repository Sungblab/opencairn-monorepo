import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/sidebar/Sidebar";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ wsSlug: string; projectId: string }>;
}) {
  const { wsSlug, projectId } = await params;

  // Server-side canRead check before rendering sidebar / children.
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
  const projRes = await fetch(`${base}/api/projects/${projectId}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (projRes.status === 403 || projRes.status === 404) notFound();
  if (!projRes.ok) throw new Error(`Failed to load project (${projRes.status})`);
  const project = (await projRes.json()) as { id: string; name: string; workspaceId: string };

  return (
    <>
      <Sidebar workspaceSlug={wsSlug} projectId={projectId} projectName={project.name} />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </>
  );
}
