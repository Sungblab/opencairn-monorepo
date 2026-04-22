"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthEyebrow } from "@/components/auth/AuthEyebrow";

type AcceptError =
  | "email_mismatch"
  | "expired"
  | "already_member"
  | "already_accepted"
  | "not_found"
  | "network"
  | "generic";

export function AcceptInviteCard({
  locale,
  token,
  info,
  currentUserEmail,
  onSwitchToCreate,
}: {
  locale: string;
  token: string;
  info: {
    workspaceId: string;
    workspaceName: string;
    inviterName: string;
    role: "admin" | "member" | "guest";
    email: string;
    expiresAt: string;
  };
  currentUserEmail: string;
  onSwitchToCreate: () => void;
}) {
  const t = useTranslations("onboarding.invite");
  const tRole = useTranslations("onboarding.invite.roles");
  const tErr = useTranslations("onboarding.invite.errors");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AcceptError | null>(null);

  const emailMismatch =
    info.email.toLowerCase() !== currentUserEmail.toLowerCase();

  async function accept() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/invites/${encodeURIComponent(token)}/accept`,
        { method: "POST" },
      );
      if (res.ok) {
        // Response: { workspaceId } — resolve slug via the workspace list.
        const wsListRes = await fetch(`/api/workspaces`);
        const list = (await wsListRes.json()) as Array<{
          id: string;
          slug: string;
        }>;
        const match = list.find((w) => w.id === info.workspaceId);
        window.location.href = match
          ? `/${locale}/app/w/${match.slug}`
          : `/${locale}/app`;
        return;
      }
      if (res.status === 403) setError("email_mismatch");
      else if (res.status === 410) setError("expired");
      else if (res.status === 409) setError("already_member");
      else if (res.status === 400) setError("already_accepted");
      else if (res.status === 404) setError("not_found");
      else setError("generic");
    } catch {
      setError("network");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2.5">
          <AuthEyebrow label={t("eyebrow")} />
          <h2 className="font-sans text-2xl font-bold leading-tight text-stone-900 kr">
            {t("title", { inviterName: info.inviterName })}
          </h2>
          <p className="text-sm text-stone-600 kr">
            {t("body", {
              workspaceName: info.workspaceName,
              role: tRole(info.role),
            })}
          </p>
        </div>

        {emailMismatch && (
          <p role="alert" className="auth-alert auth-alert-warn kr">
            {t("emailMismatchHint", { inviteEmail: info.email })}
          </p>
        )}

        {error && (
          <p role="alert" aria-live="polite" className="auth-alert kr">
            {tErr(error)}
          </p>
        )}

        <button
          type="button"
          onClick={accept}
          disabled={loading || emailMismatch}
          data-testid="invite-accept"
          className="auth-btn auth-btn-primary w-full kr"
        >
          {loading ? "…" : t("accept")}
        </button>

        <button
          type="button"
          onClick={onSwitchToCreate}
          data-testid="invite-create-instead"
          className="text-center text-sm font-semibold text-stone-700 hover:bg-stone-900 hover:text-stone-50 underline underline-offset-2 decoration-2 decoration-stone-400 hover:decoration-stone-50 hover:no-underline py-2 rounded-md border-2 border-transparent hover:border-stone-900 transition-colors kr"
        >
          {t("declineAndCreate")}
        </button>
      </div>
    </AuthCard>
  );
}
