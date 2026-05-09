"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { FileUp, Link2, ListChecks, MessageSquareText, Type } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { openIngestTab } from "@/components/ingest/open-ingest-tab";
import { useIngestUpload } from "@/hooks/use-ingest-upload";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { urls } from "@/lib/urls";
import { useIngestStore } from "@/stores/ingest-store";
import { TargetPicker, type ImportTarget } from "./target-picker";

const MODES = ["file", "link", "text"] as const;
type FirstSourceMode = (typeof MODES)[number];

const ACCEPT_ATTR = [
  "application/pdf",
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".hwp",
  ".hwpx",
  "text/plain",
  "text/markdown",
  ".txt",
  ".md",
  "image/*",
  "audio/*",
  "video/*",
].join(",");

const MODE_ICONS = {
  file: FileUp,
  link: Link2,
  text: Type,
} satisfies Record<FirstSourceMode, typeof FileUp>;

function sourceLabelFromUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return url.hostname.replace(/^www\./, "") || raw;
  } catch {
    return raw;
  }
}

function normalizeSourceUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function sourceMimeFromUrl(raw: string): string {
  try {
    const hostname = new URL(raw).hostname.toLowerCase();
    const isYoutubeHost =
      hostname === "youtu.be" ||
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com");
    return isYoutubeHost ? "x-opencairn/youtube" : "x-opencairn/web-url";
  } catch {
    return "x-opencairn/web-url";
  }
}

function boundedProjectName(input: string, fallback: string): string {
  const name = input.trim() || fallback;
  return name.length > 100 ? `${name.slice(0, 97)}...` : name;
}

function textToPlateValue(text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (paragraphs.length > 0 ? paragraphs : [text.trim()]).map((part) => ({
    type: "p",
    children: [{ text: part }],
  }));
}

export function FirstSourceIntake({
  wsSlug,
  initialMode = "file",
  showModeTabs = true,
}: {
  wsSlug: string;
  initialMode?: FirstSourceMode;
  showModeTabs?: boolean;
}) {
  const locale = useLocale();
  const router = useRouter();
  const workspaceId = useWorkspaceId(wsSlug);
  const t = useTranslations("import.firstSource");
  const tabBaseId = useId();
  const [mode, setMode] = useState<FirstSourceMode>(initialMode);
  const [target, setTarget] = useState<ImportTarget>({ kind: "new" });
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { upload, isUploading, error: uploadError } = useIngestUpload();

  useEffect(() => {
    setMode(initialMode);
    setError(null);
  }, [initialMode]);

  const canStart = useMemo(() => {
    if (mode === "file") return Boolean(file);
    if (mode === "link") return link.trim().length > 0;
    return text.trim().length > 0;
  }, [file, link, mode, text]);

  const activePanelId = `${tabBaseId}-${mode}-panel`;

  async function createProject(name: string): Promise<string | null> {
    if (!workspaceId) return null;
    const res = await fetch(`/api/workspaces/${workspaceId}/projects`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description: "" }),
    });
    if (!res.ok) return null;
    const project = (await res.json()) as { id: string };
    return project.id;
  }

  async function resolveProjectId(projectName: string): Promise<string | null> {
    if (target.kind === "existing") return target.projectId;
    return createProject(projectName);
  }

  async function startFile() {
    if (!file) {
      setError(t("errors.fileRequired"));
      return;
    }
    const projectId = await resolveProjectId(
      boundedProjectName(
        file.name ? file.name.replace(/\.[^.]+$/, "") : "",
        t("projectName.file"),
      ),
    );
    if (!projectId) {
      setError(t(workspaceId ? "errors.project" : "errors.workspace"));
      return;
    }
    const result = await upload(file, projectId);
    openIngestTab(result.workflowId, file.name);
    router.push(urls.workspace.root(locale, wsSlug));
  }

  async function startLink() {
    const raw = link.trim();
    if (!raw) {
      setError(t("errors.linkRequired"));
      return;
    }
    const normalized = normalizeSourceUrl(raw);
    if (!normalized) {
      setError(t("errors.linkInvalid"));
      return;
    }
    const label = sourceLabelFromUrl(normalized);
    const projectId = await resolveProjectId(
      boundedProjectName(label, t("projectName.link")),
    );
    if (!projectId) {
      setError(t(workspaceId ? "errors.project" : "errors.workspace"));
      return;
    }
    const res = await fetch("/api/ingest/url", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: normalized, projectId }),
    });
    if (!res.ok) {
      setError(t("errors.generic"));
      return;
    }
    const result = (await res.json()) as { workflowId: string };
    const mime = sourceMimeFromUrl(normalized);
    useIngestStore.getState().startRun(result.workflowId, mime, label);
    openIngestTab(result.workflowId, label);
    router.push(urls.workspace.root(locale, wsSlug));
  }

  async function startText() {
    const bodyText = text.trim();
    if (!bodyText) {
      setError(t("errors.textRequired"));
      return;
    }
    const title = textTitle.trim() || t("projectName.text");
    const projectId = await resolveProjectId(
      boundedProjectName(title, t("projectName.text")),
    );
    if (!projectId) {
      setError(t(workspaceId ? "errors.project" : "errors.workspace"));
      return;
    }
    const res = await fetch("/api/notes", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        title,
        type: "source",
        sourceType: "manual",
        content: textToPlateValue(bodyText),
        contentText: bodyText,
      }),
    });
    if (!res.ok) {
      setError(t("errors.generic"));
      return;
    }
    const note = (await res.json()) as { id: string; projectId: string };
    router.push(urls.workspace.projectNote(locale, wsSlug, note.projectId, note.id));
  }

  async function handleStart() {
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "file") await startFile();
      if (mode === "link") await startLink();
      if (mode === "text") await startText();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby={`${tabBaseId}-title`}
      className="rounded-[var(--radius-card)] border border-border bg-background"
    >
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.55fr)]">
        <div className="space-y-5 p-5 sm:p-6">
          <div>
            <h2 id={`${tabBaseId}-title`} className="text-xl font-semibold">
              {t("title")}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t("description")}
            </p>
          </div>

          {showModeTabs ? (
            <div role="tablist" aria-label={t("tabs.label")} className="grid grid-cols-3 gap-2">
              {MODES.map((id) => {
                const Icon = MODE_ICONS[id];
                const selected = mode === id;
                return (
                  <button
                    key={id}
                    id={`${tabBaseId}-${id}-tab`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`${tabBaseId}-${id}-panel`}
                    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded border px-3 text-sm font-medium transition ${
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    onClick={() => {
                      setMode(id);
                      setError(null);
                    }}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {t(`tabs.${id}`)}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div
            id={activePanelId}
            role={showModeTabs ? "tabpanel" : undefined}
            aria-labelledby={showModeTabs ? `${tabBaseId}-${mode}-tab` : undefined}
            className="min-h-[210px] rounded-[var(--radius-card)] border border-border bg-background p-4"
          >
            {mode === "file" ? (
              <div className="space-y-3">
                <label className="block text-sm font-medium" htmlFor={`${tabBaseId}-file`}>
                  {t("file.label")}
                </label>
                <label
                  className="flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-border bg-muted/20 px-4 text-center text-sm transition hover:border-foreground hover:bg-muted/40"
                  htmlFor={`${tabBaseId}-file`}
                >
                  <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden />
                  <span className="font-medium">
                    {file ? t("file.selected", { name: file.name }) : t("file.empty")}
                  </span>
                  <span className="max-w-md text-xs leading-5 text-muted-foreground">
                    {t("file.hint")}
                  </span>
                </label>
                <input
                  id={`${tabBaseId}-file`}
                  type="file"
                  className="sr-only"
                  accept={ACCEPT_ATTR}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </div>
            ) : null}

            {mode === "link" ? (
              <label className="block text-sm font-medium" htmlFor={`${tabBaseId}-link`}>
                {t("link.label")}
                <input
                  id={`${tabBaseId}-link`}
                  type="url"
                  inputMode="url"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                  placeholder={t("link.placeholder")}
                  className="mt-2 block min-h-11 w-full rounded border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
            ) : null}

            {mode === "text" ? (
              <div className="space-y-3">
                <label className="block text-sm font-medium" htmlFor={`${tabBaseId}-text-title`}>
                  {t("text.titleLabel")}
                  <input
                    id={`${tabBaseId}-text-title`}
                    value={textTitle}
                    onChange={(event) => setTextTitle(event.target.value)}
                    placeholder={t("text.titlePlaceholder")}
                    className="mt-2 block min-h-11 w-full rounded border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm font-medium" htmlFor={`${tabBaseId}-text`}>
                  {t("text.label")}
                  <textarea
                    id={`${tabBaseId}-text`}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder={t("text.placeholder")}
                    maxLength={64 * 1024}
                    rows={7}
                    className="mt-2 block min-h-[148px] w-full resize-y rounded border border-border bg-background px-3 py-2 text-sm leading-6"
                  />
                </label>
              </div>
            ) : null}
          </div>

          <TargetPicker wsSlug={wsSlug} value={target} onChange={setTarget} />

          {(error || uploadError) && (
            <p className="text-sm text-destructive" role="alert">
              {error ?? t("errors.generic")}
            </p>
          )}

          <button
            type="button"
            disabled={!canStart || submitting || isUploading || !workspaceId}
            onClick={handleStart}
            className="inline-flex min-h-11 items-center rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting || isUploading ? t("actions.starting") : t("actions.start")}
          </button>
        </div>

        <aside className="border-t border-border bg-muted/20 p-5 lg:border-l lg:border-t-0 lg:p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="h-4 w-4" aria-hidden />
            {t("pipeline.title")}
          </h3>
          <ol className="mt-4 space-y-3">
            {(["read", "extract", "questions", "note"] as const).map((step, index) => (
              <li key={step} className="flex gap-3 text-sm">
                <span
                  aria-hidden
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border bg-background text-xs font-semibold"
                >
                  {index + 1}
                </span>
                <span className="leading-6 text-muted-foreground">
                  {t(`pipeline.${step}`)}
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex items-start gap-2 rounded border border-border bg-background p-3 text-xs leading-5 text-muted-foreground">
            <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{t("followup")}</span>
          </div>
        </aside>
      </div>
    </section>
  );
}
