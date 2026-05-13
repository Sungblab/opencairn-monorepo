"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  wsSettingsApi,
  type WorkspaceMemberRow,
  type WorkspaceRole,
} from "@/lib/api-client";

const ASSIGNABLE_ROLES: ReadonlyArray<"admin" | "member" | "guest"> = [
  "admin",
  "member",
  "guest",
];

export function MembersTab({ wsId }: { wsId: string }) {
  const t = useTranslations("workspaceSettings.members");
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["ws-members", wsId],
    queryFn: () => wsSettingsApi.members(wsId),
  });

  const patchRole = useMutation({
    mutationFn: ({
      userId,
      role,
    }: {
      userId: string;
      role: "admin" | "member" | "guest";
    }) => wsSettingsApi.patchMemberRole(wsId, userId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ws-members", wsId] }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => wsSettingsApi.removeMember(wsId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ws-members", wsId] }),
  });

  return (
    <section className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">{t("heading")}</h1>
      </div>
      {data && data.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-border bg-background px-4 py-5 text-sm text-muted-foreground shadow-sm sm:px-5">
          {t("empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-background shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left sm:px-5">{t("headerName")}</th>
              <th className="px-4 py-3 text-left">{t("headerEmail")}</th>
              <th className="px-4 py-3 text-left">{t("headerRole")}</th>
              <th className="px-4 py-3 text-left sm:px-5" aria-hidden></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((m: WorkspaceMemberRow) => {
              const isOwner = m.role === "owner";
              return (
                <tr key={m.userId} className="border-t border-border">
                  <td className="px-4 py-4 font-medium sm:px-5">{m.name}</td>
                  <td className="px-4 py-4 text-xs text-muted-foreground">
                    {m.email}
                  </td>
                  <td className="px-4 py-4">
                    {isOwner ? (
                      <span className="text-xs text-muted-foreground">
                        {t(`roleLabels.${m.role satisfies WorkspaceRole}`)}
                      </span>
                    ) : (
                      <select
                        aria-label={t("rolePlaceholder")}
                        defaultValue={m.role}
                        onChange={(e) =>
                          patchRole.mutate({
                            userId: m.userId,
                            role: e.target.value as
                              | "admin"
                              | "member"
                              | "guest",
                          })
                        }
                        className="min-h-9 rounded-[var(--radius-control)] border border-border bg-background px-3 py-1.5 text-xs"
                      >
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t(`roleLabels.${r}`)}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right sm:px-5">
                    {isOwner ? (
                      <span
                        className="text-[10px] text-muted-foreground"
                        title={t("ownerLocked")}
                      >
                        —
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => remove.mutate(m.userId)}
                        className="app-btn-ghost min-h-9 rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs"
                      >
                        {t("remove")}
                      </button>
                    )}
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
