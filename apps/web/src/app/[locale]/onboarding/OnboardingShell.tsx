"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CreateWorkspaceForm } from "./CreateWorkspaceForm";
import { AcceptInviteCard } from "./AcceptInviteCard";
import type { InviteFetchResult } from "./page";

type Mode = "invite" | "create";

export function OnboardingShell({
  locale,
  currentUserEmail,
  token,
  inviteResult,
  hasExistingWorkspace,
  firstWorkspaceSlug: _firstWorkspaceSlug,
}: {
  locale: string;
  currentUserEmail: string;
  token: string | null;
  inviteResult: InviteFetchResult | null;
  hasExistingWorkspace: boolean;
  firstWorkspaceSlug: string | null;
}) {
  const t = useTranslations("onboarding");
  const [mode, setMode] = useState<Mode>(
    inviteResult?.status === "ok" ? "invite" : "create",
  );

  // Clear any sessionStorage invite marker once we've landed here —
  // the token made it through, so downstream flows shouldn't reuse it.
  useEffect(() => {
    try {
      sessionStorage.removeItem("opencairn:pending_invite");
    } catch {
      // sessionStorage may be unavailable (private mode); ignore.
    }
  }, []);

  if (mode === "invite" && inviteResult?.status === "ok" && token) {
    return (
      <AcceptInviteCard
        locale={locale}
        token={token}
        info={inviteResult.data}
        currentUserEmail={currentUserEmail}
        onSwitchToCreate={() => setMode("create")}
      />
    );
  }

  const banner: string | null = (() => {
    // Suppress when there's no invite to report on, or the user has
    // explicitly switched to "create" after seeing a valid invite (decline
    // path). For error states the banner must show regardless of mode —
    // an invalid/expired token starts the user in `mode === "create"`
    // because there's no AcceptInviteCard to render, and they'd otherwise
    // have no idea why they landed on the create form.
    if (!inviteResult) return null;
    if (inviteResult.status === "ok") return null;
    switch (inviteResult.status) {
      case "not_found":
        return t("invite.errors.not_found");
      case "expired":
        return t("invite.errors.expired");
      case "already_accepted":
        return hasExistingWorkspace
          ? null
          : t("invite.errors.already_accepted");
      case "bad_request":
        return t("invite.errors.bad_request");
      case "network_error":
        return t("invite.errors.network");
      default:
        return null;
    }
  })();

  return (
    <div className="flex flex-col gap-5">
      {banner && (
        <p role="status" aria-live="polite" className="auth-alert auth-alert-info kr">
          {banner}
        </p>
      )}
      <CreateWorkspaceForm locale={locale} />
    </div>
  );
}
