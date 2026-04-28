"use client";

import { useTranslations } from "next-intl";
import type { McpServerSummary } from "@opencairn/shared";

import { Button } from "@/components/ui/button";

export function McpServerList({
  servers,
  onTest,
  onEdit,
  onDelete,
}: {
  servers: McpServerSummary[];
  onTest: (id: string) => void;
  onEdit: (server: McpServerSummary) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations("settings.mcp");
  if (servers.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("list.empty")}</p>;
  }

  return (
    <ul className="divide-y rounded-lg border border-border">
      {servers.map((server) => (
        <li
          key={server.id}
          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {server.displayName}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {server.serverUrl}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <StatusBadge status={server.status} />
              <span className="text-muted-foreground">
                {t("list.tool_count", { count: server.lastSeenToolCount })}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={() => onTest(server.id)}>
              {t("list.test_button")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onEdit(server)}>
              {t("list.edit_button")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDelete(server.id)}
            >
              {t("list.delete_button")}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ status }: { status: McpServerSummary["status"] }) {
  const t = useTranslations("settings.mcp.status");
  const className =
    status === "active"
      ? "text-green-700"
      : status === "auth_expired"
        ? "text-amber-700"
        : "text-muted-foreground";
  return <span className={className}>{t(status)}</span>;
}
