"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { wsSettingsApi, shareApi } from "@/lib/api-client";

export function SharedLinksTab({ wsId }: { wsId: string }) {
  const t = useTranslations("workspaceSettings.sharedLinks");
  const tRole = useTranslations("shareDialog.role");
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["ws-shared-links", wsId],
    queryFn: () => wsSettingsApi.sharedLinks(wsId),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => shareApi.revoke(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["ws-shared-links", wsId] }),
  });

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{t("heading")}</h2>
      {data && data.links.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="pb-2 text-left">{t("headerNote")}</th>
              <th className="pb-2 text-left">{t("headerRole")}</th>
              <th className="pb-2 text-left">{t("headerCreatedBy")}</th>
              <th className="pb-2 text-left">{t("headerCreatedAt")}</th>
              <th className="pb-2 text-left" aria-hidden></th>
            </tr>
          </thead>
          <tbody>
            {(data?.links ?? []).map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="py-2">{l.noteTitle}</td>
                <td className="py-2 text-xs text-muted-foreground">
                  {tRole(l.role)}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {l.createdBy.name}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {new Date(l.createdAt).toLocaleDateString()}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => revoke.mutate(l.id)}
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                  >
                    {t("revoke")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
