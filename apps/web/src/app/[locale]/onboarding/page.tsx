import { urls } from "@/lib/urls";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n";
import { OnboardingShell } from "./OnboardingShell";

// Server-side mutation calls to the API need an Origin header that the
// API's csrfOriginGuard recognizes as trusted — server fetch doesn't set
// one automatically. Derive it from incoming request headers (matches what
// the browser would send), falling back to PUBLIC_WEB_URL for edge cases
// where the host header is absent.
function deriveOrigin(headerList: Awaited<ReturnType<typeof headers>>): string {
  const origin = headerList.get("origin");
  if (origin) return origin;
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  return process.env.PUBLIC_WEB_URL ?? "http://localhost:3000";
}

interface InviteInfo {
  workspaceId: string;
  workspaceName: string;
  inviterName: string;
  role: "admin" | "member" | "guest";
  email: string;
  expiresAt: string;
}

export type InviteFetchResult =
  | { status: "ok"; data: InviteInfo }
  | {
      status:
        | "not_found"
        | "expired"
        | "already_accepted"
        | "bad_request"
        | "network_error";
    };

async function fetchInvite(
  apiBase: string,
  token: string,
): Promise<InviteFetchResult> {
  try {
    const res = await fetch(
      `${apiBase}/api/invites/${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
    if (res.ok) return { status: "ok", data: (await res.json()) as InviteInfo };
    if (res.status === 404) return { status: "not_found" };
    if (res.status === 410) return { status: "expired" };
    if (res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === "already_accepted") return { status: "already_accepted" };
      return { status: "bad_request" };
    }
    return { status: "network_error" };
  } catch {
    return { status: "network_error" };
  }
}

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const [{ locale }, { invite }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as Locale);

  const cookieHeader = (await cookies()).toString();
  const requestHeaders = await headers();
  const apiBase = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

  // Guard 1: session
  const meRes = await fetch(`${apiBase}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!meRes.ok) {
    const returnTo = `/onboarding${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;
    redirect(
      `/${locale}/auth/login?return_to=${encodeURIComponent(returnTo)}`,
    );
  }
  const me = (await meRes.json()) as {
    userId: string;
    email: string;
    name: string;
    emailVerified?: boolean;
  };

  // Guard 2: email verified — only redirect when we actually know it's false.
  // If the field is absent, trust that the Better Auth flow already enforced
  // it at signup.
  if (me.emailVerified === false) {
    redirect(`/${locale}/auth/verify-email`);
  }

  // Guard 3: workspace existence
  const wsRes = await fetch(`${apiBase}/api/workspaces`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!wsRes.ok) {
    throw new Error(`Failed to load workspaces (${wsRes.status})`);
  }
  const workspaces = (await wsRes.json()) as Array<{
    slug: string;
    id: string;
  }>;

  // User already belongs to a workspace AND no invite → send to /app.
  if (workspaces.length > 0 && !invite) {
    redirect(urls.workspace.root(locale, workspaces[0]!.slug));
  }

  // No workspace AND no invite → auto-provision a personal workspace named
  // after the signed-in user. The user can rename later in workspace settings.
  // We only render the shell when we have something for the user to decide
  // (an invite token to accept/decline). Slug derivation runs server-side in
  // /api/workspaces; non-ASCII names fall back to `w-{random}` automatically.
  if (workspaces.length === 0 && !invite) {
    const t = await getTranslations({
      locale: locale as Locale,
      namespace: "onboarding.create",
    });
    const defaultName = t("defaultName", { name: me.name });
    const createRes = await fetch(`${apiBase}/api/workspaces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
        origin: deriveOrigin(requestHeaders),
      },
      body: JSON.stringify({ name: defaultName }),
      cache: "no-store",
    });
    if (createRes.status === 201) {
      const ws = (await createRes.json()) as { slug: string };
      redirect(urls.workspace.root(locale, ws.slug));
    }
    // Fall through to the shell if auto-provision unexpectedly failed —
    // user can retry via the manual form.
  }

  // Otherwise: resolve invite (if any), render shell.
  const inviteResult: InviteFetchResult | null = invite
    ? await fetchInvite(apiBase, invite)
    : null;

  return (
    <OnboardingShell
      locale={locale}
      currentUserEmail={me.email}
      token={invite ?? null}
      inviteResult={inviteResult}
      hasExistingWorkspace={workspaces.length > 0}
      firstWorkspaceSlug={workspaces[0]?.slug ?? null}
    />
  );
}
