"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { McpServerCreate, McpServerSummary } from "@opencairn/shared";

import {
  createServer,
  deleteServer,
  listServers,
  mcpServersQueryKey,
  testServer,
  updateServer,
} from "@/lib/api/mcp";
import {
  listMcpTokenWorkspaces,
  mcpTokenWorkspacesQueryKey,
} from "@/lib/api/mcp-server-tokens";
import { Button } from "@/components/ui/button";
import { McpServerForm } from "./McpServerForm";
import { McpServerList } from "./McpServerList";
import { McpServerTokenCard } from "./McpServerTokenCard";

export function McpSettingsClient({
  mcpClientEnabled = true,
  mcpServerEnabled = true,
}: {
  mcpClientEnabled?: boolean;
  mcpServerEnabled?: boolean;
}) {
  const t = useTranslations("settings.mcp");
  const qc = useQueryClient();
  const [editing, setEditing] = useState<McpServerSummary | "new" | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  const servers = useQuery({
    queryKey: mcpServersQueryKey(),
    queryFn: listServers,
    enabled: mcpClientEnabled,
  });
  const workspaces = useQuery({
    queryKey: mcpTokenWorkspacesQueryKey(),
    queryFn: listMcpTokenWorkspaces,
    enabled: mcpServerEnabled,
  });
  const adminWorkspaces = useMemo(
    () =>
      (workspaces.data ?? []).filter((workspace) =>
        ["owner", "admin"].includes(workspace.role),
      ),
    [workspaces.data],
  );

  useEffect(() => {
    if (!selectedWorkspaceId && adminWorkspaces[0]) {
      setSelectedWorkspaceId(adminWorkspaces[0].id);
    }
  }, [adminWorkspaces, selectedWorkspaceId]);

  const save = useMutation({
    mutationFn: (payload: McpServerCreate & { id?: string }) => {
      const { id, ...body } = payload;
      return id ? updateServer(id, body) : createServer(body);
    },
    onSuccess: () => {
      setEditing(null);
      toast.success(t("form.saved"));
      void qc.invalidateQueries({ queryKey: mcpServersQueryKey() });
    },
    onError: () => toast.error(t("form.save_failed")),
  });

  const remove = useMutation({
    mutationFn: deleteServer,
    onSuccess: () => {
      toast.success(t("list.deleted"));
      void qc.invalidateQueries({ queryKey: mcpServersQueryKey() });
    },
  });

  const test = useMutation({
    mutationFn: testServer,
    onSuccess: (result) => {
      if (result.status === "ok") {
        toast.success(t("test_result.ok", { count: result.toolCount }));
      } else if (result.status === "auth_failed") {
        toast.error(t("test_result.auth_failed"));
      } else {
        toast.error(t("test_result.transport_error"));
      }
      void qc.invalidateQueries({ queryKey: mcpServersQueryKey() });
    },
  });

  return (
    <section className="space-y-6">
      {mcpClientEnabled ? (
        <div className="space-y-4">
        {editing ? (
          <McpServerForm
            mode={editing === "new" ? "create" : "edit"}
            initial={editing === "new" ? undefined : editing}
            onSubmit={(payload) => save.mutate(payload)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <Button onClick={() => setEditing("new")}>{t("form.add_button")}</Button>
        )}
        {servers.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("list.loading")}</p>
        ) : servers.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {t("list.load_failed")}
          </p>
        ) : (
          <McpServerList
            servers={servers.data ?? []}
            onTest={(id) => test.mutate(id)}
            onEdit={setEditing}
            onDelete={(id) => {
              if (confirm(t("list.delete_confirm_body"))) remove.mutate(id);
            }}
          />
        )}
        </div>
      ) : null}

      {mcpServerEnabled ? (
        <div className="space-y-3">
        <label className="flex max-w-sm flex-col gap-1 text-sm">
          <span>{t("server_tokens.workspace")}</span>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={selectedWorkspaceId ?? ""}
            onChange={(event) => setSelectedWorkspaceId(event.target.value || null)}
            disabled={workspaces.isLoading || adminWorkspaces.length === 0}
          >
            {adminWorkspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        {workspaces.isLoading ? (
          <p className="text-sm text-muted-foreground">
            {t("server_tokens.workspaces_loading")}
          </p>
        ) : workspaces.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {t("server_tokens.workspaces_failed")}
          </p>
        ) : selectedWorkspaceId ? (
          <McpServerTokenCard workspaceId={selectedWorkspaceId} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("server_tokens.no_admin_workspace")}
          </p>
        )}
        </div>
      ) : null}
    </section>
  );
}
