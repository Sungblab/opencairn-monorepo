"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { McpServerCreate, McpServerSummary } from "@opencairn/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function McpServerForm({
  mode,
  initial,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: McpServerSummary;
  onSubmit: (payload: McpServerCreate & { id?: string }) => void | Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations("settings.mcp.form");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [serverUrl, setServerUrl] = useState(initial?.serverUrl ?? "");
  const [authHeaderName, setAuthHeaderName] = useState(
    initial?.authHeaderName ?? "Authorization",
  );
  const [authHeaderValue, setAuthHeaderValue] = useState("");

  return (
    <form
      className="rounded-lg border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          ...(initial ? { id: initial.id } : {}),
          displayName: displayName.trim(),
          serverUrl: serverUrl.trim(),
          authHeaderName: authHeaderName.trim() || "Authorization",
          ...(authHeaderValue.trim()
            ? { authHeaderValue: authHeaderValue.trim() }
            : {}),
        });
      }}
    >
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm">
          <span>{t("display_name")}</span>
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t("server_url")}</span>
          <Input
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            disabled={mode === "edit"}
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t("auth_header_name")}</span>
          <Input
            value={authHeaderName}
            onChange={(event) => setAuthHeaderName(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t("auth_header_value")}</span>
          <Input
            type="password"
            value={authHeaderValue}
            onChange={(event) => setAuthHeaderValue(event.target.value)}
            autoComplete="off"
          />
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={!displayName.trim() || !serverUrl.trim()}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
