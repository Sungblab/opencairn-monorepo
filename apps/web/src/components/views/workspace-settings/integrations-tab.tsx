"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { integrationsApi } from "@/lib/api-client";

// Single integration today (Google Drive). Adding more = more rows here +
// extra api-client helpers; the layout stays a stacked list.
export function IntegrationsTab({ wsId }: { wsId: string }) {
  const t = useTranslations("workspaceSettings.integrations");
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["integrations-google", wsId],
    queryFn: () => integrationsApi.google(wsId),
  });
  const disconnect = useMutation({
    mutationFn: () => integrationsApi.disconnectGoogle(wsId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["integrations-google", wsId] }),
  });

  // The /api/integrations/google/connect endpoint requires a workspaceId so
  // the OAuth callback knows which workspace to pin tokens against. We use
  // a vanilla anchor (full nav) because the OAuth dance bounces through
  // accounts.google.com and back to a server route — not a SPA transition.
  const connectHref = `/api/integrations/google/connect?workspaceId=${wsId}`;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("heading")}</h2>
      <div className="flex items-center justify-between rounded-[var(--radius-card)] border border-border p-4">
        <div>
          <p className="text-sm font-medium">{t("google.name")}</p>
          <p className="text-xs text-muted-foreground">
            {data?.connected
              ? t("google.connected", {
                  email: data.accountEmail ?? "",
                })
              : t("google.disconnected")}
          </p>
        </div>
        {data?.connected ? (
          <button
            type="button"
            onClick={() => disconnect.mutate()}
            className="app-btn-ghost rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs"
          >
            {t("google.disconnect")}
          </button>
        ) : (
          <a
            href={connectHref}
            className="app-btn-primary rounded-[var(--radius-control)] px-3 py-1.5 text-xs"
          >
            {t("google.connect")}
          </a>
        )}
      </div>
    </section>
  );
}
