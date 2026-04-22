"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

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
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-sans text-xl text-stone-900">
          {t("title", { inviterName: info.inviterName })}
        </h2>
        <p className="text-sm text-stone-500">
          {t("body", {
            workspaceName: info.workspaceName,
            role: tRole(info.role),
          })}
        </p>
      </div>

      {emailMismatch && (
        <p
          role="alert"
          className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-md"
        >
          {t("emailMismatchHint", { inviteEmail: info.email })}
        </p>
      )}

      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md"
        >
          {tErr(error)}
        </p>
      )}

      <Button
        type="button"
        onClick={accept}
        disabled={loading || emailMismatch}
        data-testid="invite-accept"
        className="w-full"
      >
        {loading ? "…" : t("accept")}
      </Button>

      <button
        type="button"
        onClick={onSwitchToCreate}
        data-testid="invite-create-instead"
        className="text-center text-sm text-stone-500 hover:text-stone-800 underline"
      >
        {t("declineAndCreate")}
      </button>
    </div>
  );
}
