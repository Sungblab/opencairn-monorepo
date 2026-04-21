import { redirect } from "next/navigation";
import { cookies } from "next/headers";

// /app → 첫 workspace로 redirect. 워크스페이스 없으면 onboarding placeholder.
export default async function AppIndex({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
  const res = await fetch(`${base}/api/workspaces`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load workspaces (${res.status})`);
  const wss = (await res.json()) as Array<{ slug: string }>;
  if (wss.length === 0) redirect(`/${locale}/onboarding`);
  redirect(`/${locale}/app/w/${wss[0].slug}`);
}
