import { redirect } from "next/navigation";
import { cookies } from "next/headers";

// /app → 사용자의 마지막 워크스페이스로 redirect.
// App Shell Phase 1: lastViewedWorkspaceId가 있으면 그쪽 우선, 없거나
// 멤버십이 사라졌으면 첫 워크스페이스. 둘 다 없으면 /onboarding.
export default async function AppIndex({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
  const headers = { cookie: cookieHeader };

  // Try last-viewed first. The endpoint already re-checks membership and
  // returns null if the user lost access — no need to defend against that
  // here, the fall-through to `/api/workspaces` covers it.
  const lvRes = await fetch(
    `${base}/api/users/me/last-viewed-workspace`,
    { headers, cache: "no-store" },
  );
  if (lvRes.ok) {
    const { workspace } = (await lvRes.json()) as {
      workspace: { id: string; slug: string } | null;
    };
    if (workspace) redirect(`/${locale}/app/w/${workspace.slug}`);
  }

  const res = await fetch(`${base}/api/workspaces`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load workspaces (${res.status})`);
  const wss = (await res.json()) as Array<{ slug: string }>;
  if (wss.length === 0) redirect(`/${locale}/onboarding`);
  redirect(`/${locale}/app/w/${wss[0].slug}`);
}
