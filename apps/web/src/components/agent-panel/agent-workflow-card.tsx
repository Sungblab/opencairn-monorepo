"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BookOpen, FilePlus2, Sparkles, X } from "lucide-react";
import type {
  StudyArtifactDifficulty,
  StudyArtifactType,
} from "@opencairn/shared";

import {
  documentGenerationApi,
  projectsApi,
  type DocumentGenerationFormat,
  type DocumentGenerationSourceOption,
  type ImageRenderEngine,
  type PdfRenderEngine,
  type ProjectNoteRow,
} from "@/lib/api-client";
import type {
  AgentWorkflowIntent,
  AgentWorkflowSubmission,
  SourcePaperAnalysisWorkflowPayload,
} from "@/stores/agent-workbench-store";
import {
  getDocumentGenerationPreset,
  type DocumentGenerationTemplate,
} from "./tool-discovery-catalog";

type Props = {
  workflow: AgentWorkflowIntent;
  projectId: string | null;
  workspaceId: string | null;
  onClose(): void;
  onSubmitWorkflow(submission: AgentWorkflowSubmission): void;
};

const STUDY_DIFFICULTIES: StudyArtifactDifficulty[] = [
  "mixed",
  "easy",
  "medium",
  "hard",
];
const FORMATS: DocumentGenerationFormat[] = ["pdf", "docx", "pptx", "xlsx", "image"];
const PDF_RENDER_ENGINES: PdfRenderEngine[] = ["latex", "pymupdf"];
const IMAGE_RENDER_ENGINES: ImageRenderEngine[] = ["svg", "model"];
const REPORT_TEMPLATES = [
  "report",
  "brief",
  "research_summary",
  "technical_report",
  "research_brief",
  "paper_style",
  "business_report",
] as const;
const TEMPLATE_OPTIONS_BY_FORMAT = {
  pdf: REPORT_TEMPLATES,
  docx: REPORT_TEMPLATES,
  pptx: ["deck", "custom"],
  xlsx: ["spreadsheet", "custom"],
  image: ["research_brief", "technical_report", "business_report", "custom"],
} satisfies Record<DocumentGenerationFormat, readonly DocumentGenerationTemplate[]>;
const DEFAULT_TEMPLATE_BY_FORMAT = {
  pdf: "technical_report",
  docx: "report",
  pptx: "deck",
  xlsx: "spreadsheet",
  image: "research_brief",
} satisfies Record<DocumentGenerationFormat, DocumentGenerationTemplate>;

function defaultFilename(
  format: DocumentGenerationFormat,
  imageEngine: ImageRenderEngine = "svg",
): string {
  if (format === "image") {
    return imageEngine === "model" ? "generated-figure.png" : "generated-figure.svg";
  }
  return `generated-document.${format}`;
}

function filenameForFormat(
  value: string,
  format: DocumentGenerationFormat,
  imageEngine: ImageRenderEngine = "svg",
): string {
  const trimmed = value.trim();
  if (!trimmed) return defaultFilename(format, imageEngine);
  const withoutExtension = trimmed.replace(/\.[^.]+$/, "");
  const extension =
    format === "image" ? (imageEngine === "model" ? "png" : "svg") : format;
  return `${withoutExtension || "generated-document"}.${extension}`;
}

function templateOptionsFor(
  format: DocumentGenerationFormat,
): readonly DocumentGenerationTemplate[] {
  return TEMPLATE_OPTIONS_BY_FORMAT[format];
}

function selectedSourceIdsFor(
  sources: DocumentGenerationSourceOption[],
  preferredIds: readonly string[],
) {
  if (preferredIds.length > 0) {
    const available = new Set(sources.map((source) => source.id));
    return preferredIds.filter((id) => available.has(id));
  }
  return sources.slice(0, 5).map((source) => source.id);
}

function getSourcePaperAnalysisPayload(
  payload: AgentWorkflowIntent["payload"],
): SourcePaperAnalysisWorkflowPayload | null {
  if (!payload || payload.action !== "source_paper_analysis") return null;
  const candidate = payload as Partial<SourcePaperAnalysisWorkflowPayload>;
  if (
    !Array.isArray(candidate.sourceIds) ||
    !candidate.sourceIds.every((id) => typeof id === "string") ||
    typeof candidate.sourceTitle !== "string" ||
    typeof candidate.initialPrompt !== "string" ||
    typeof candidate.initialFilename !== "string"
  ) {
    return null;
  }
  return {
    action: "source_paper_analysis",
    sourceIds: candidate.sourceIds,
    sourceTitle: candidate.sourceTitle,
    initialPrompt: candidate.initialPrompt,
    initialFilename: candidate.initialFilename,
  };
}

export function AgentWorkflowCard({
  workflow,
  projectId,
  workspaceId,
  onClose,
  onSubmitWorkflow,
}: Props) {
  const toolsT = useTranslations("project.tools");
  const t = useTranslations("agentPanel.workflowCard");
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-background px-3 py-3 shadow-sm">
      <div className="mb-3 flex items-start gap-2">
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] bg-muted text-foreground">
          <Sparkles aria-hidden className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {toolsT(`items.${workflow.i18nKey}.title`)}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("close")}
          onClick={onClose}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
      {workflow.kind === "literature_search" ? (
        <LiteratureWorkflow
          workflow={workflow}
          workspaceId={workspaceId}
          onSubmitWorkflow={onSubmitWorkflow}
        />
      ) : workflow.kind === "study_artifact" ? (
        <StudyArtifactWorkflow
          workflow={workflow}
          projectId={projectId}
          onSubmitWorkflow={onSubmitWorkflow}
        />
      ) : workflow.kind === "document_generation" ? (
        <DocumentWorkflow
          workflow={workflow}
          projectId={projectId}
          onSubmitWorkflow={onSubmitWorkflow}
        />
      ) : workflow.kind === "teach_to_learn" ? (
        <TeachWorkflow
          workflow={workflow}
          projectId={projectId}
          onSubmitWorkflow={onSubmitWorkflow}
        />
      ) : workflow.route === "workspace_import_web" ||
        workflow.route === "workspace_import_youtube" ? (
        <UrlImportWorkflow
          workflow={workflow}
          onSubmitWorkflow={onSubmitWorkflow}
        />
      ) : (
        <PromptWorkflow workflow={workflow} onSubmitWorkflow={onSubmitWorkflow} />
      )}
    </section>
  );
}

function PromptWorkflow({
  workflow,
  onSubmitWorkflow,
}: {
  workflow: AgentWorkflowIntent;
  onSubmitWorkflow(submission: AgentWorkflowSubmission): void;
}) {
  const t = useTranslations("agentPanel.workflowCard");
  const [prompt, setPrompt] = useState(workflow.prompt);
  return (
    <div className="space-y-2">
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.currentTarget.value)}
        className="min-h-24 w-full resize-none rounded-[var(--radius-control)] border border-border bg-background px-2 py-2 text-sm outline-none focus:border-foreground"
      />
      <button
        type="button"
        className="app-btn-primary inline-flex h-8 items-center justify-center rounded-[var(--radius-control)] px-3 text-xs"
        onClick={() =>
          onSubmitWorkflow({
            kind: workflow.kind,
            toolId: workflow.toolId,
            prompt,
          })
        }
      >
        {t("sendToAgent")}
      </button>
    </div>
  );
}

function UrlImportWorkflow({
  workflow,
  onSubmitWorkflow,
}: {
  workflow: AgentWorkflowIntent;
  onSubmitWorkflow(submission: AgentWorkflowSubmission): void;
}) {
  const t = useTranslations("agentPanel.workflowCard");
  const [url, setUrl] = useState("");
  const trimmed = url.trim();
  const canSubmit = /^https?:\/\/\S+$/i.test(trimmed);
  const isYoutube = workflow.route === "workspace_import_youtube";
  return (
    <div className="space-y-2">
      <input
        value={url}
        onChange={(event) => setUrl(event.currentTarget.value)}
        placeholder={isYoutube ? "https://www.youtube.com/watch?v=..." : "https://..."}
        className="h-9 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 text-sm outline-none focus:border-foreground"
      />
      <button
        type="button"
        disabled={!canSubmit}
        className="app-btn-primary inline-flex h-8 items-center justify-center rounded-[var(--radius-control)] px-3 text-xs disabled:opacity-50"
        onClick={() =>
          onSubmitWorkflow({
            kind: workflow.kind,
            toolId: workflow.toolId,
            prompt: `${workflow.prompt}\n\nURL: ${trimmed}\n이 URL을 현재 프로젝트 자료로 가져오고, 완료 후 요약 흐름으로 이어가줘.`,
            payload: {
              action: "ingest_url",
              url: trimmed,
              source: isYoutube ? "youtube" : "web",
            },
          })
        }
      >
        {t("sendToAgent")}
      </button>
    </div>
  );
}

function LiteratureWorkflow({
  workflow,
  workspaceId,
  onSubmitWorkflow,
}: {
  workflow: AgentWorkflowIntent;
  workspaceId: string | null;
  onSubmitWorkflow(submission: AgentWorkflowSubmission): void;
}) {
  const t = useTranslations("agentPanel.workflowCard");
  const literatureT = useTranslations("literature");
  const [query, setQuery] = useState("");
  const canSearch = Boolean(workspaceId && query.trim());
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || !canSearch) return;
    const trimmed = query.trim();
    onSubmitWorkflow({
      kind: workflow.kind,
      toolId: workflow.toolId,
      prompt: `${workflow.prompt}\n\n검색 주제: ${trimmed}\n관련 논문을 찾고, 가져올 후보를 추천한 뒤 필요한 import.literature 액션을 제안해줘.`,
      payload: {
        action: "search_and_recommend_imports",
        query: trimmed,
      },
    });
  }
  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={literatureT("search.placeholder")}
          className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground"
        />
        <button
          type="submit"
          disabled={!canSearch}
          className="app-btn-primary inline-flex h-9 items-center justify-center rounded-[var(--radius-control)] px-3 text-xs disabled:opacity-50"
        >
          {literatureT("search.button")}
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="app-btn-ghost inline-flex h-8 items-center justify-center gap-1 rounded-[var(--radius-control)] border border-border px-3 text-xs"
          onClick={() =>
            onSubmitWorkflow({
              kind: workflow.kind,
              toolId: workflow.toolId,
              prompt: query.trim()
                ? `${workflow.prompt}\n\n검색 주제: ${query.trim()}`
                : workflow.prompt,
              payload: {
                action: "discuss_literature_strategy",
                query: query.trim() || undefined,
              },
            })
          }
        >
          <BookOpen aria-hidden className="h-3.5 w-3.5" />
          {t("sendToAgent")}
        </button>
      </div>
    </div>
  );
}

function StudyArtifactWorkflow({
  workflow,
  projectId,
  onSubmitWorkflow,
}: {
  workflow: AgentWorkflowIntent;
  projectId: string | null;
  onSubmitWorkflow(submission: AgentWorkflowSubmission): void;
}) {
  const t = useTranslations("agentPanel.workflowCard");
  const studyT = useTranslations("project.tools.studyArtifact");
  const [notes, setNotes] = useState<ProjectNoteRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [difficulty, setDifficulty] =
    useState<StudyArtifactDifficulty>("mixed");
  const [itemCount, setItemCount] = useState(10);
  const [title, setTitle] = useState("");
  const [error, setError] = useState(false);
  const artifactType: StudyArtifactType =
    workflow.artifactType ?? "quiz_set";
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void projectsApi
      .notes(projectId, "all")
      .then((response) => {
        if (cancelled) return;
        setNotes(response.notes);
        setSelectedIds(response.notes.slice(0, 3).map((note) => note.id));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  function generate() {
    if (!projectId || selectedIds.length === 0) return;
    setError(false);
    onSubmitWorkflow({
      kind: workflow.kind,
      toolId: workflow.toolId,
      prompt: `${workflow.prompt}\n\n선택한 노트를 기반으로 ${artifactType} 학습 자료를 만들어줘.`,
      payload: {
        action: "generate_study_artifact",
        type: artifactType,
        sourceNoteIds: selectedIds,
        title: title.trim() || undefined,
        difficulty,
        tags: [],
        itemCount,
      },
    });
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>{studyT("difficultyLabel")}</span>
          <select
            value={difficulty}
            onChange={(event) =>
              setDifficulty(event.currentTarget.value as StudyArtifactDifficulty)
            }
            className="h-8 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 text-foreground"
          >
            {STUDY_DIFFICULTIES.map((value) => (
              <option key={value} value={value}>
                {studyT(`difficulties.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>{studyT("itemCountLabel")}</span>
          <input
            type="number"
            min={1}
            max={20}
            value={itemCount}
            onChange={(event) =>
              setItemCount(Math.max(1, Math.min(20, Number(event.currentTarget.value) || 1)))
            }
            className="h-8 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 text-foreground"
          />
        </label>
      </div>
      <input
        value={title}
        onChange={(event) => setTitle(event.currentTarget.value)}
        placeholder={studyT("titlePlaceholder")}
        className="h-8 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 text-sm outline-none focus:border-foreground"
      />
      <div className="app-scrollbar-thin max-h-44 overflow-y-auto rounded-[var(--radius-control)] border border-border p-1">
        {notes.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {studyT("noNotes")}
          </p>
        ) : (
          notes.map((note) => (
            <label
              key={note.id}
              className="flex min-h-8 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 text-xs hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(note.id)}
                onChange={() => {
                  setSelectedIds((current) =>
                    current.includes(note.id)
                      ? current.filter((id) => id !== note.id)
                      : [...current, note.id].slice(0, 20),
                  );
                }}
              />
              <span className="truncate">{note.title}</span>
            </label>
          ))
        )}
      </div>
      {error ? <p className="text-xs text-destructive">{studyT("submitError")}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!projectId || selectedIds.length === 0}
          onClick={generate}
          className="app-btn-primary inline-flex h-8 items-center justify-center rounded-[var(--radius-control)] px-3 text-xs disabled:opacity-50"
        >
          {studyT("generate")}
        </button>
        <button
          type="button"
          className="app-btn-ghost inline-flex h-8 items-center justify-center rounded-[var(--radius-control)] border border-border px-3 text-xs"
          onClick={() =>
            onSubmitWorkflow({
              kind: workflow.kind,
              toolId: workflow.toolId,
              prompt: workflow.prompt,
              payload: { action: "discuss_study_artifact" },
            })
          }
        >
          {t("sendToAgent")}
        </button>
      </div>
    </div>
  );
}

function DocumentWorkflow({
  workflow,
  projectId,
  onSubmitWorkflow,
}: {
  workflow: AgentWorkflowIntent;
  projectId: string | null;
  onSubmitWorkflow(submission: AgentWorkflowSubmission): void;
}) {
  const t = useTranslations("agentPanel.workflowCard");
  const docT = useTranslations("agentPanel.documentGeneration");
  const locale = useLocale();
  const preset = getDocumentGenerationPreset(workflow.presetId ?? "pdf_report_fast");
  const sourcePayload = useMemo(
    () => getSourcePaperAnalysisPayload(workflow.payload),
    [workflow.payload],
  );
  const preferredSourceIds = useMemo(
    () => sourcePayload?.sourceIds ?? [],
    [sourcePayload],
  );
  const preferredSourceKey = preferredSourceIds.join("\u0000");
  const initialFilename =
    sourcePayload?.initialFilename ?? docT(`presetFilename.${preset.filenameBaseKey}`);
  const initialPrompt =
    sourcePayload?.initialPrompt ?? docT(`presetPrompt.${preset.promptKey}`);
  const workflowConfigKey = [
    workflow.id,
    preset.id,
    preferredSourceKey,
    initialFilename,
    initialPrompt,
  ].join("\u0001");
  const workflowConfigRef = useRef(workflowConfigKey);
  const [sources, setSources] = useState<DocumentGenerationSourceOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [format, setFormat] = useState<DocumentGenerationFormat>(preset.format);
  const [renderEngine, setRenderEngine] = useState<PdfRenderEngine>(
    preset.renderEngine ?? "pymupdf",
  );
  const [imageEngine, setImageEngine] = useState<ImageRenderEngine>(
    preset.imageEngine ?? "svg",
  );
  const [template, setTemplate] = useState<DocumentGenerationTemplate>(
    preset.template,
  );
  const [filename, setFilename] = useState(initialFilename);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void documentGenerationApi
      .sources(projectId)
      .then((response) => {
        if (cancelled) return;
        setSources(response.sources);
        setSelectedIds(selectedSourceIdsFor(response.sources, preferredSourceIds));
      })
      .catch(() => {
        if (!cancelled) setError(docT("loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [docT, preferredSourceIds, projectId]);
  useEffect(() => {
    if (workflowConfigRef.current === workflowConfigKey) return;
    workflowConfigRef.current = workflowConfigKey;
    setFormat(preset.format);
    setRenderEngine(preset.renderEngine ?? "pymupdf");
    setImageEngine(preset.imageEngine ?? "svg");
    setTemplate(preset.template);
    setFilename(initialFilename);
    setPrompt(initialPrompt);
    setSelectedIds(selectedSourceIdsFor(sources, preferredSourceIds));
  }, [
    initialFilename,
    initialPrompt,
    preferredSourceIds,
    preset,
    sources,
    workflowConfigKey,
  ]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedSources = useMemo(
    () => sources.filter((source) => selectedIdSet.has(source.id)),
    [selectedIdSet, sources],
  );
  function generate() {
    if (!projectId || selectedSources.length === 0 || !prompt.trim()) return;
    setError(null);
    const generationPrompt = sourcePayload
      ? withSourceAnalysisStructure(prompt.trim(), locale)
      : prompt.trim();
    onSubmitWorkflow({
      kind: workflow.kind,
      toolId: workflow.toolId,
      prompt: `${workflow.prompt}\n\n${generationPrompt}\n\n선택한 자료를 바탕으로 ${format.toUpperCase()} 산출물을 만들어줘.`,
      payload: {
        action: "generate_project_object",
        generation: {
          format,
          prompt: generationPrompt,
          locale,
          template,
          ...(format === "pdf" ? { renderEngine } : {}),
          ...(format === "image" ? { imageEngine } : {}),
          sources: selectedSources.map((source) => source.source),
          destination: {
            filename: filenameForFormat(filename, format, imageEngine),
            publishAs: "agent_file",
            startIngest: false,
          },
          artifactMode: "object_storage",
        },
      },
    });
  }
  return (
    <div className="space-y-3">
      <div className="app-scrollbar-thin max-h-44 overflow-y-auto rounded-[var(--radius-control)] border border-border p-1">
        {sources.map((source) => (
          <label
            key={source.id}
            className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs hover:bg-muted"
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={selectedIdSet.has(source.id)}
              onChange={(event) => {
                setSelectedIds((ids) =>
                  event.target.checked
                    ? [...ids, source.id]
                    : ids.filter((id) => id !== source.id),
                );
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{source.title}</span>
              <span className="block truncate text-muted-foreground">
                {docT(`sourceLabel.${source.type}`)}
                {source.subtitle ? ` · ${source.subtitle}` : ""}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="grid grid-cols-[80px_1fr] gap-2 text-xs">
        <label className="text-muted-foreground" htmlFor="workflow-doc-format">
          {docT("format")}
        </label>
        <select
          id="workflow-doc-format"
          value={format}
          onChange={(event) => {
            const next = event.currentTarget.value as DocumentGenerationFormat;
            setFormat(next);
            setTemplate(DEFAULT_TEMPLATE_BY_FORMAT[next]);
          }}
          className="rounded border border-border bg-background px-2 py-1"
        >
          {FORMATS.map((value) => (
            <option key={value} value={value}>
              {value.toUpperCase()}
            </option>
          ))}
        </select>
        <label className="text-muted-foreground" htmlFor="workflow-doc-template">
          {docT("template")}
        </label>
        <select
          id="workflow-doc-template"
          value={template}
          onChange={(event) =>
            setTemplate(event.currentTarget.value as DocumentGenerationTemplate)
          }
          className="rounded border border-border bg-background px-2 py-1"
        >
          {templateOptionsFor(format).map((value) => (
            <option key={value} value={value}>
              {docT(`templateOption.${value}`)}
            </option>
          ))}
        </select>
        <label className="text-muted-foreground" htmlFor="workflow-doc-filename">
          {docT("filename")}
        </label>
        <input
          id="workflow-doc-filename"
          value={filename}
          onChange={(event) => setFilename(event.currentTarget.value)}
          className="rounded border border-border bg-background px-2 py-1"
        />
        {format === "pdf" ? (
          <>
            <label className="text-muted-foreground" htmlFor="workflow-doc-engine">
              {docT("renderEngine")}
            </label>
            <select
              id="workflow-doc-engine"
              value={renderEngine}
              onChange={(event) =>
                setRenderEngine(event.currentTarget.value as PdfRenderEngine)
              }
              className="rounded border border-border bg-background px-2 py-1"
            >
              {PDF_RENDER_ENGINES.map((value) => (
                <option key={value} value={value}>
                  {docT(`renderEngineOption.${value}`)}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {format === "image" ? (
          <>
            <label className="text-muted-foreground" htmlFor="workflow-image-engine">
              {docT("imageEngine")}
            </label>
            <select
              id="workflow-image-engine"
              value={imageEngine}
              onChange={(event) =>
                setImageEngine(event.currentTarget.value as ImageRenderEngine)
              }
              className="rounded border border-border bg-background px-2 py-1"
            >
              {IMAGE_RENDER_ENGINES.map((value) => (
                <option key={value} value={value}>
                  {docT(`imageEngineOption.${value}`)}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.currentTarget.value)}
        className="min-h-20 w-full resize-none rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-foreground"
      />
      {selectedSources.length === 0 ? (
        <p className="text-xs text-muted-foreground">{docT("sourceRequired")}</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!projectId || selectedSources.length === 0}
          onClick={generate}
          className="app-btn-primary inline-flex h-8 items-center justify-center gap-1 rounded-[var(--radius-control)] px-3 text-xs disabled:opacity-50"
        >
          <FilePlus2 aria-hidden className="h-3.5 w-3.5" />
          {docT("submit")}
        </button>
        <button
          type="button"
          className="app-btn-ghost inline-flex h-8 items-center justify-center rounded-[var(--radius-control)] border border-border px-3 text-xs"
          onClick={() =>
            onSubmitWorkflow({
              kind: workflow.kind,
              toolId: workflow.toolId,
              prompt: workflow.prompt,
              payload: { action: "discuss_document_generation" },
            })
          }
        >
          {t("sendToAgent")}
        </button>
      </div>
    </div>
  );
}

function withSourceAnalysisStructure(prompt: string, locale: string) {
  const instruction =
    locale === "ko"
      ? "산출물 첫머리에 목차를 만들고, 주요 주장과 근거 뒤에는 가능한 한 [p. N] 형식의 페이지 단위 인용 앵커를 붙여줘. Markdown/문서 본문에는 섹션 제목을 명확히 남겨 산출물 뷰어 목차에서 이동할 수 있게 해줘."
      : "Start the artifact with a table of contents, add page-level citation anchors in [p. N] format after major claims and evidence whenever possible, and keep clear section headings so the artifact viewer can build navigation.";
  return prompt.includes("[p. N]") ? prompt : `${prompt}\n\n${instruction}`;
}

function TeachWorkflow({
  workflow,
  projectId,
  onSubmitWorkflow,
}: {
  workflow: AgentWorkflowIntent;
  projectId: string | null;
  onSubmitWorkflow(submission: AgentWorkflowSubmission): void;
}) {
  const panelT = useTranslations("agentPanel.projectTools");
  const t = useTranslations("agentPanel.workflowCard");
  return (
    <div className="rounded-[var(--radius-control)] border border-border bg-muted/10 px-3 py-3">
      {projectId ? (
        <button
          type="button"
          className="app-btn-primary inline-flex h-8 items-center justify-center rounded-[var(--radius-control)] px-3 text-xs"
          onClick={() =>
            onSubmitWorkflow({
              kind: workflow.kind,
              toolId: workflow.toolId,
              prompt: `${workflow.prompt}\n\n프로젝트 자료를 바탕으로 소크라테스식 튜터링 세션을 시작해줘. 먼저 학습 목표와 난이도를 짧게 물어봐.`,
              payload: { action: "start_socratic_session" },
            })
          }
        >
          {t("sendToAgent")}
        </button>
      ) : (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          {panelT("noProject")}
        </p>
      )}
    </div>
  );
}
