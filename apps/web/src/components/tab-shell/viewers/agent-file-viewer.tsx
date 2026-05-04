"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Download,
  Eye,
  FileCode,
  FileText,
  GitBranch,
  Play,
  RefreshCcw,
  Table2,
  UploadCloud,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { JsonView, defaultStyles } from "react-json-view-lite";
import remarkGfm from "remark-gfm";
import type { AgentFileSummary } from "@opencairn/shared";
import "react-json-view-lite/dist/index.css";
import type { Tab } from "@/stores/tabs-store";
import { useTabsStore } from "@/stores/tabs-store";
import { newTab } from "@/lib/tab-factory";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";

interface AgentFileResponse {
  file: AgentFileSummary;
}

export function AgentFileViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("agentFiles.viewer");
  const qc = useQueryClient();
  const targetId = tab.targetId;
  const { data, isLoading, isError } = useQuery<AgentFileResponse>({
    queryKey: ["agent-file", targetId],
    enabled: Boolean(targetId),
    queryFn: async () => {
      const res = await fetch(`/api/agent-files/${targetId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`agent-file ${res.status}`);
      return (await res.json()) as AgentFileResponse;
    },
  });

  const compile = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agent-files/${targetId}/compile`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`compile ${res.status}`);
      return (await res.json()) as AgentFileResponse;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-file", targetId] }),
  });

  const ingest = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agent-files/${targetId}/ingest`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`ingest ${res.status}`);
      return (await res.json()) as AgentFileResponse;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-file", targetId] }),
  });

  const canvas = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agent-files/${targetId}/canvas`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`canvas ${res.status}`);
      return (await res.json()) as { noteId: string };
    },
    onSuccess: ({ noteId }) => {
      const tabs = useTabsStore.getState();
      tabs.addTab(
        newTab({
          kind: "note",
          targetId: noteId,
          title: data?.file.title ?? t("canvas"),
          mode: "canvas",
          preview: false,
        }),
      );
    },
  });

  if (!targetId) return null;
  if (isLoading) {
    return <div className="h-full p-4 text-sm text-muted-foreground">{t("loading")}</div>;
  }
  if (isError || !data?.file) {
    return <div className="h-full p-4 text-sm text-destructive">{t("error")}</div>;
  }

  const file = data.file;
  const fileUrl = `/api/agent-files/${file.id}/file`;
  const compiledUrl = `/api/agent-files/${file.id}/compiled`;

  return (
    <div data-testid="agent-file-viewer" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{file.filename}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {t("meta", {
              kind: file.kind,
              version: file.version,
              bytes: formatBytes(file.bytes),
            })}
            {file.kind === "latex" ? (
              <StatusPill label={t(`compileStatus.${file.compileStatus}`)} />
            ) : null}
            <StatusPill label={t(`ingestStatus.${file.ingestStatus}`)} />
          </div>
        </div>
        <a
          href={fileUrl}
          download={file.filename}
          title={t("download")}
          aria-label={t("download")}
          className={buttonVariants({ size: "sm", variant: "ghost" })}
        >
          <Download className="h-4 w-4" />
        </a>
        <Button
          size="sm"
          variant="ghost"
          title={t("ingest")}
          aria-label={t("ingest")}
          onClick={() => ingest.mutate()}
          disabled={ingest.isPending}
        >
          <UploadCloud className="h-4 w-4" />
        </Button>
        {file.kind === "latex" ? (
          <Button
            size="sm"
            variant="ghost"
            title={t("compile")}
            aria-label={t("compile")}
            onClick={() => compile.mutate()}
            disabled={compile.isPending}
          >
            <RefreshCcw className="h-4 w-4" />
          </Button>
        ) : null}
        {file.kind === "code" || file.kind === "html" ? (
          <Button
            size="sm"
            variant="ghost"
            title={t("canvas")}
            aria-label={t("canvas")}
            onClick={() => canvas.mutate()}
            disabled={canvas.isPending}
          >
            <Play className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        <FileBody file={file} fileUrl={fileUrl} compiledUrl={compiledUrl} />
      </div>
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">
      {label}
    </span>
  );
}

function FileBody({
  file,
  fileUrl,
  compiledUrl,
}: {
  file: AgentFileSummary;
  fileUrl: string;
  compiledUrl: string;
}) {
  const t = useTranslations("agentFiles.viewer");
  const textLike = useMemo(
    () => ["text", "latex", "code"].includes(file.kind),
    [file.kind],
  );

  if (file.kind === "image") {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-muted/30 p-4">
        <img src={fileUrl} alt={file.filename} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  if (file.kind === "html") {
    return (
      <PreviewSourceFrame fileUrl={fileUrl} sourceLabel={t("source")}>
        <iframe
          title={file.filename}
          src={fileUrl}
          sandbox="allow-scripts"
          className="h-full w-full border-0"
        />
      </PreviewSourceFrame>
    );
  }
  if (file.kind === "pdf") {
    return <iframe title={file.filename} src={fileUrl} className="h-full w-full border-0" />;
  }
  if (file.kind === "latex" && file.compileStatus === "completed") {
    return (
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        <TextPreview fileUrl={fileUrl} />
        <iframe title={`${file.filename} PDF`} src={compiledUrl} className="h-full w-full border-0 border-l" />
      </div>
    );
  }
  if (file.kind === "markdown") return <MarkdownPreview fileUrl={fileUrl} />;
  if (file.kind === "json") return <JsonPreview fileUrl={fileUrl} />;
  if (file.kind === "csv") return <CsvPreview fileUrl={fileUrl} />;
  if (textLike) return <TextPreview fileUrl={fileUrl} />;
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <FileCode className="mr-2 h-4 w-4" />
      {file.mimeType}
    </div>
  );
}

function PreviewSourceFrame({
  children,
  fileUrl,
  sourceLabel,
}: {
  children: ReactNode;
  fileUrl: string;
  sourceLabel: string;
}) {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-2">
      <div className="min-h-0">{children}</div>
      <div className="min-h-0 border-l">
        <TextPreview fileUrl={fileUrl} label={sourceLabel} />
      </div>
    </div>
  );
}

function MarkdownPreview({ fileUrl }: { fileUrl: string }) {
  const t = useTranslations("agentFiles.viewer");
  const { data, isLoading } = useTextFile(fileUrl);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-2">
      <div className="h-full overflow-auto p-6">
        <div className="mb-4 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          {t("preview")}
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("loadingInline")}</p>
        ) : (
          <article className="max-w-4xl space-y-4 text-sm leading-7">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 className="text-2xl font-semibold leading-tight">{children}</h1>,
                h2: ({ children }) => <h2 className="text-xl font-semibold leading-tight">{children}</h2>,
                h3: ({ children }) => <h3 className="text-base font-semibold leading-tight">{children}</h3>,
                p: ({ children }) => <p>{children}</p>,
                ul: ({ children }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 pl-4 text-muted-foreground">{children}</blockquote>
                ),
                code: ({ children }) => (
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
                ),
                pre: ({ children }) => (
                  <pre className="overflow-auto rounded border bg-muted/40 p-3 text-xs leading-5">{children}</pre>
                ),
                table: ({ children }) => <table className="min-w-full border-collapse text-xs">{children}</table>,
                th: ({ children }) => <th className="border-b px-3 py-2 text-left font-medium">{children}</th>,
                td: ({ children }) => <td className="border-b px-3 py-2 align-top">{children}</td>,
              }}
            >
              {data ?? ""}
            </ReactMarkdown>
          </article>
        )}
      </div>
      <div className="min-h-0 border-l">
        <TextPreview fileUrl={fileUrl} label={t("source")} />
      </div>
    </div>
  );
}

function JsonPreview({ fileUrl }: { fileUrl: string }) {
  const t = useTranslations("agentFiles.viewer");
  const { data, isLoading } = useTextFile(fileUrl);
  const parsed = useMemo(() => {
    if (!data) return null;
    try {
      return JSON.parse(data) as object;
    } catch {
      return null;
    }
  }, [data]);

  if (isLoading) return <div className="h-full p-4 text-sm text-muted-foreground">{t("loadingInline")}</div>;
  if (parsed == null) return <TextPreview fileUrl={fileUrl} />;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-2">
      <div className="h-full overflow-auto p-4 text-sm">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5" />
          {t("jsonTree")}
        </div>
        <JsonView data={parsed} style={defaultStyles} />
      </div>
      <div className="min-h-0 border-l">
        <TextPreview fileUrl={fileUrl} label={t("source")} />
      </div>
    </div>
  );
}

function CsvPreview({ fileUrl }: { fileUrl: string }) {
  const t = useTranslations("agentFiles.viewer");
  const { data, isLoading } = useTextFile(fileUrl);
  const table = useMemo(() => parseCsv(data ?? ""), [data]);

  if (isLoading) return <div className="h-full p-4 text-sm text-muted-foreground">{t("loadingInline")}</div>;
  if (table.length === 0) return <TextPreview fileUrl={fileUrl} />;

  const headers = table[0] ?? [];
  const rows = table.slice(1);
  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-2">
      <div className="h-full overflow-auto p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Table2 className="h-3.5 w-3.5" />
          {t("csvTable", { rows: rows.length })}
        </div>
        <table className="min-w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-background">
            <tr>
              {headers.map((cell, index) => (
                <th key={index} className="border-b px-3 py-2 font-medium text-muted-foreground">
                  {cell || t("column", { index: index + 1 })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b last:border-0">
                {headers.map((_, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={cn("px-3 py-2 align-top", rowIndex % 2 === 1 && "bg-muted/20")}
                  >
                    <div className="max-w-80 truncate">{row[cellIndex] ?? ""}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="min-h-0 border-l">
        <TextPreview fileUrl={fileUrl} label={t("source")} />
      </div>
    </div>
  );
}

function TextPreview({ fileUrl, label }: { fileUrl: string; label?: string }) {
  const t = useTranslations("agentFiles.viewer");
  const { data, isLoading } = useTextFile(fileUrl);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {label ? (
        <div className="flex h-9 items-center gap-2 border-b px-3 text-xs font-medium text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          {label}
        </div>
      ) : null}
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5">
        {isLoading ? t("loadingInline") : data}
      </pre>
    </div>
  );
}

function useTextFile(fileUrl: string) {
  return useQuery({
    queryKey: ["agent-file-text", fileUrl],
    queryFn: async () => {
      const res = await fetch(fileUrl, { credentials: "include" });
      if (!res.ok) throw new Error(`file ${res.status}`);
      return res.text();
    },
  });
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.length > 1 || row[0].length > 0) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }

  row.push(cell);
  if (row.length > 1 || row[0].length > 0) rows.push(row);
  return rows.slice(0, 500);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
