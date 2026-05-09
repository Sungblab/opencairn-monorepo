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
    <section>
      <h2 className="mb-3 text-lg font-semibold">{t("heading")}</h2>
      {data && data.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="pb-2 text-left">{t("headerName")}</th>
              <th className="pb-2 text-left">{t("headerEmail")}</th>
              <th className="pb-2 text-left">{t("headerRole")}</th>
              <th className="pb-2 text-left" aria-hidden></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((m: WorkspaceMemberRow) => {
              const isOwner = m.role === "owner";
              return (
                <tr key={m.userId} className="border-t border-border">
                  <td className="py-2">{m.name}</td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {m.email}
                  </td>
                  <td className="py-2">
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
                        className="rounded-[var(--radius-control)] border border-border bg-transparent px-2 py-1 text-xs"
                      >
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t(`roleLabels.${r}`)}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="py-2 text-right">
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
                        className="app-btn-ghost rounded-[var(--radius-control)] border border-border px-2 py-1 text-xs"
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
      )}
    </section>
  );
}
