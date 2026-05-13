"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  wsSettingsApi,
  type WorkspaceInviteRow,
} from "@/lib/api-client";

const ROLES: ReadonlyArray<"admin" | "member" | "guest"> = [
  "admin",
  "member",
  "guest",
];

function statusOf(
  invite: WorkspaceInviteRow,
): "pending" | "accepted" | "expired" {
  if (invite.acceptedAt) return "accepted";
  if (new Date(invite.expiresAt) < new Date()) return "expired";
  return "pending";
}

export function InvitesTab({ wsId }: { wsId: string }) {
  const t = useTranslations("workspaceSettings.invites");
  const tRoles = useTranslations("workspaceSettings.members.roleLabels");
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["ws-invites", wsId],
    queryFn: () => wsSettingsApi.invites(wsId),
  });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member" | "guest">("member");

  const create = useMutation({
    mutationFn: () => wsSettingsApi.createInvite(wsId, email, role),
    onSuccess: () => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["ws-invites", wsId] });
    },
  });
  const cancel = useMutation({
    mutationFn: (inviteId: string) =>
      wsSettingsApi.cancelInvite(wsId, inviteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ws-invites", wsId] }),
  });

  return (
    <section className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">{t("heading")}</h1>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email) create.mutate();
        }}
        className="grid gap-3 rounded-[var(--radius-card)] border border-border bg-background px-4 py-5 shadow-sm sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end sm:px-5"
      >
        <label className="flex flex-col gap-1 text-xs">
          <span>{t("newEmailLabel")}</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-10 w-full rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span>{t("newRoleLabel")}</span>
          <select
            value={role}
            onChange={(e) =>
              setRole(e.target.value as "admin" | "member" | "guest")
            }
            className="min-h-10 rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {tRoles(r)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!email || create.isPending}
          className="app-btn-primary min-h-10 rounded-[var(--radius-control)] px-4 py-2 text-sm font-medium"
        >
          {t("send")}
        </button>
      </form>
      {data && data.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-border bg-background px-4 py-5 text-sm text-muted-foreground shadow-sm sm:px-5">
          {t("empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-background shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left sm:px-5">{t("headerEmail")}</th>
              <th className="px-4 py-3 text-left">{t("headerRole")}</th>
              <th className="px-4 py-3 text-left">{t("headerStatus")}</th>
              <th className="px-4 py-3 text-left sm:px-5" aria-hidden></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((inv) => {
              const s = statusOf(inv);
              return (
                <tr key={inv.id} className="border-t border-border">
                  <td className="px-4 py-4 font-medium sm:px-5">{inv.email}</td>
                  <td className="px-4 py-4 text-xs text-muted-foreground">
                    {tRoles(inv.role)}
                  </td>
                  <td className="px-4 py-4 text-xs text-muted-foreground">
                    {t(
                      s === "pending"
                        ? "statusPending"
                        : s === "accepted"
                          ? "statusAccepted"
                          : "statusExpired",
                    )}
                  </td>
                  <td className="px-4 py-4 text-right sm:px-5">
                    {s === "pending" ? (
                      <button
                        type="button"
                        onClick={() => cancel.mutate(inv.id)}
                        className="app-btn-ghost min-h-9 rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs"
                      >
                        {t("cancel")}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}
