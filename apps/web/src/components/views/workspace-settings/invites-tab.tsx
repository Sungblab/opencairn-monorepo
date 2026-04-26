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
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">{t("heading")}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email) create.mutate();
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <label className="flex flex-col gap-1 text-xs">
          <span>{t("newEmailLabel")}</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-64 rounded border border-border bg-transparent px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span>{t("newRoleLabel")}</span>
          <select
            value={role}
            onChange={(e) =>
              setRole(e.target.value as "admin" | "member" | "guest")
            }
            className="rounded border border-border bg-transparent px-2 py-1"
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
          className="rounded bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
        >
          {t("send")}
        </button>
      </form>
      {data && data.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="pb-2 text-left">{t("headerEmail")}</th>
              <th className="pb-2 text-left">{t("headerRole")}</th>
              <th className="pb-2 text-left">{t("headerStatus")}</th>
              <th className="pb-2 text-left" aria-hidden></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((inv) => {
              const s = statusOf(inv);
              return (
                <tr key={inv.id} className="border-t border-border">
                  <td className="py-2">{inv.email}</td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {tRoles(inv.role)}
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {t(
                      s === "pending"
                        ? "statusPending"
                        : s === "accepted"
                          ? "statusAccepted"
                          : "statusExpired",
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {s === "pending" ? (
                      <button
                        type="button"
                        onClick={() => cancel.mutate(inv.id)}
                        className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
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
      )}
    </section>
  );
}
