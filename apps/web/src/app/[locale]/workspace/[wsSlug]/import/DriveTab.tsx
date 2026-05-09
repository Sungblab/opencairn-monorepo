"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useGoogleIntegration } from "@/hooks/useGoogleIntegration";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { urls } from "@/lib/urls";
import { TargetPicker, type ImportTarget } from "@/components/import/target-picker";

// MVP without Google Picker: user pastes/types Drive file ids. Google
// Picker SDK integration is tracked as a follow-up — it needs a public
// OAuth client id exposed to the browser, plus gapi+GIS script loading,
// and is nice-to-have rather than critical for the import data flow.
// The OAuth connection itself (callback + token encryption) already
// lives in /api/integrations/google and works end-to-end.

function parseFileIds(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function DriveTab({ wsSlug }: { wsSlug: string }) {
  const locale = useLocale();
  const t = useTranslations("import");
  const router = useRouter();
  const workspaceId = useWorkspaceId(wsSlug);
  const { status, loading, connectUrl, disconnect } =
    useGoogleIntegration(workspaceId);
  const [fileIdInput, setFileIdInput] = useState("");
  const [target, setTarget] = useState<ImportTarget>({ kind: "new" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }

  if (!status?.connected) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("drive.notConnected")}
        </p>
        <a
          href={workspaceId ? connectUrl(workspaceId) : "#"}
          className="inline-flex rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          aria-disabled={!workspaceId}
        >
          {t("drive.notConnected")}
        </a>
      </div>
    );
  }

  const fileIds = parseFileIds(fileIdInput);

  async function submit() {
    if (!workspaceId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/import/drive", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          fileIds,
          target,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        const errKey =
          body.error === "import_limit_exceeded"
            ? "importLimitExceeded"
            : body.error === "drive_not_connected"
              ? "driveNotConnected"
              : null;
        setError(errKey ? t(`errors.${errKey}`) : t("progress.failed"));
        return;
      }
      const { jobId } = (await res.json()) as { jobId: string };
      router.push(urls.workspace.importJob(locale, wsSlug, jobId));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded border border-border bg-muted/30 p-3">
        <p className="text-sm">
          {t("drive.connectedAs", { email: status.accountEmail ?? "" })}
        </p>
        <button
          type="button"
          onClick={() => disconnect()}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {t("drive.disconnect")}
        </button>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("drive.pickFiles")}</span>
        <textarea
          value={fileIdInput}
          onChange={(e) => setFileIdInput(e.target.value)}
          rows={4}
          className="block w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs"
          placeholder="1a2b3c... (one Drive file id per line or separated by commas)"
        />
        {fileIds.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("drive.selectedCount", { count: fileIds.length, size: "—" })}
          </p>
        )}
      </label>

      <TargetPicker wsSlug={wsSlug} value={target} onChange={setTarget} />

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={fileIds.length === 0 || submitting || !workspaceId}
        onClick={submit}
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {t("actions.start")}
      </button>
    </div>
  );
}
