"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createMcpServerToken,
  listMcpServerTokens,
  mcpServerTokensQueryKey,
  revokeMcpServerToken,
} from "@/lib/api/mcp-server-tokens";

export function McpServerTokenCard({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("settings.mcp.server_tokens");
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const tokens = useQuery({
    queryKey: mcpServerTokensQueryKey(workspaceId),
    queryFn: () => listMcpServerTokens(workspaceId),
  });

  const create = useMutation({
    mutationFn: () =>
      createMcpServerToken({
        workspaceId,
        label: label.trim(),
        expiresAt: null,
      }),
    onSuccess: (created) => {
      setCreatedToken(created.token);
      setLabel("");
      toast.success(t("created"));
      void qc.invalidateQueries({ queryKey: mcpServerTokensQueryKey(workspaceId) });
    },
    onError: () => toast.error(t("create_failed")),
  });

  const revoke = useMutation({
    mutationFn: revokeMcpServerToken,
    onSuccess: () => {
      toast.success(t("revoked"));
      void qc.invalidateQueries({ queryKey: mcpServerTokensQueryKey(workspaceId) });
    },
    onError: () => toast.error(t("revoke_failed")),
  });
  const tokenRows = tokens.data?.tokens ?? [];

  return (
    <section className="rounded-lg border border-border p-6">
      <h2 className="text-base font-medium">{t("heading")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (label.trim()) create.mutate();
        }}
      >
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span>{t("label")}</span>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={t("placeholder")}
            autoComplete="off"
          />
        </label>
        <Button type="submit" disabled={!label.trim() || create.isPending}>
          {create.isPending ? t("creating") : t("create")}
        </Button>
      </form>

      {createdToken ? (
        <div className="mt-4 rounded-md border border-border bg-muted p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t("copy_once")}</p>
              <code className="mt-2 block max-w-full break-all rounded bg-background p-2 text-xs">
                {createdToken}
              </code>
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label={t("copy")}
              title={t("copy")}
              onClick={() => void navigator.clipboard?.writeText(createdToken)}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {tokens.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("loading")}</p>
      ) : tokens.isError ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {t("load_failed")}
        </p>
      ) : tokenRows.length > 0 ? (
        <ul className="mt-4 divide-y divide-border">
          {tokenRows.map((token) => (
            <li key={token.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium">{token.label}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {token.tokenPrefix}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => revoke.mutate(token.id)}
                disabled={revoke.isPending || token.revokedAt !== null}
              >
                {token.revokedAt ? t("revoked_label") : t("revoke")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </section>
  );
}
