"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { urls } from "@/lib/urls";
import { TargetPicker, type ImportTarget } from "@/components/import/target-picker";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function MarkdownTab({ wsSlug }: { wsSlug: string }) {
  const locale = useLocale();
  const t = useTranslations("import");
  const router = useRouter();
  const workspaceId = useWorkspaceId(wsSlug);
  const [file, setFile] = useState<File | null>(null);
  const [objectKey, setObjectKey] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<ImportTarget>({ kind: "new" });
  const [submitting, setSubmitting] = useState(false);

  async function upload(f: File) {
    if (!workspaceId) return;
    setFile(f);
    setObjectKey(null);
    setProgress(0);
    setError(null);
    setUploading(true);
    try {
      const urlRes = await fetch("/api/import/markdown/upload-url", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          size: f.size,
          originalName: f.name,
        }),
      });
      if (!urlRes.ok) {
        const body = (await urlRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(
          body.error === "zip_too_large"
            ? t("errors.zipTooLarge")
            : t("progress.failed"),
        );
        return;
      }
      const { objectKey: key, uploadUrl } = (await urlRes.json()) as {
        objectKey: string;
        uploadUrl: string;
      };

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("content-type", "application/zip");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error("network"));
        xhr.send(f);
      });

      setObjectKey(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!workspaceId || !objectKey || !file) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/import/markdown", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          zipObjectKey: objectKey,
          originalName: file.name,
          target,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(
          body.error === "import_limit_exceeded"
            ? t("errors.importLimitExceeded")
            : t("progress.failed"),
        );
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
      <p className="text-sm text-muted-foreground">
        {t("markdown.instructions")}
      </p>

      {!file && (
        <label className="block cursor-pointer rounded border-2 border-dashed border-border p-8 text-center text-sm transition hover:border-primary">
          <input
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <span>{t("markdown.dropZone")}</span>
        </label>
      )}

      {file && uploading && (
        <div className="rounded border border-border p-4">
          <p className="text-sm">{t("markdown.uploading", { progress })}</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {file && !uploading && objectKey && (
        <>
          <p className="rounded bg-muted/50 p-3 text-sm">
            {t("markdown.uploaded", {
              name: file.name,
              size: formatBytes(file.size),
            })}
          </p>

          <TargetPicker wsSlug={wsSlug} value={target} onChange={setTarget} />

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={submitting || !workspaceId}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {t("actions.start")}
          </button>
        </>
      )}

      {error && !objectKey && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
