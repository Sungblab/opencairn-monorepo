import { urls } from "@/lib/urls";
import type { AgentWorkflowIntent } from "@/stores/agent-workbench-store";
import {
  getDocumentGenerationPreset,
  type ToolDiscoveryItem,
} from "./tool-discovery-catalog";

export type ToolDiscoveryRoute = Extract<
  ToolDiscoveryItem["action"],
  { type: "route" }
>["route"];

export function getToolRouteHref({
  route,
  locale,
  wsSlug,
  projectId,
}: {
  route: ToolDiscoveryRoute;
  locale: string;
  wsSlug: string;
  projectId: string;
}): string {
  if (route === "project_graph") {
    return urls.workspace.projectGraph(locale, wsSlug, projectId);
  }
  if (route === "project_graph_mindmap") {
    return `${urls.workspace.projectGraph(locale, wsSlug, projectId)}?view=mindmap`;
  }
  if (route === "project_agents") {
    return urls.workspace.projectAgents(locale, wsSlug, projectId);
  }
  if (route === "project_learn_flashcards") {
    return urls.workspace.projectLearnFlashcards(locale, wsSlug, projectId);
  }
  if (route === "project_learn_socratic") {
    return urls.workspace.projectLearnSocratic(locale, wsSlug, projectId);
  }
  if (route === "workspace_integrations") {
    return urls.workspace.settingsSection(
      locale,
      wsSlug,
      "workspace",
      "integrations",
    );
  }
  if (route === "workspace_import_web") {
    return `${urls.workspace.import(locale, wsSlug)}?projectId=${encodeURIComponent(
      projectId,
    )}&source=web`;
  }
  if (route === "workspace_import_youtube") {
    return `${urls.workspace.import(locale, wsSlug)}?projectId=${encodeURIComponent(
      projectId,
    )}&source=youtube`;
  }
  return urls.workspace.projectLearn(locale, wsSlug, projectId);
}

export function routeShouldOpenAsWorkflow(route: ToolDiscoveryRoute): boolean {
  return (
    route === "project_learn" ||
    route === "project_learn_flashcards" ||
    route === "project_learn_socratic" ||
    route === "workspace_import_web" ||
    route === "workspace_import_youtube"
  );
}

export function toolShouldOpenAsWorkflow(item: ToolDiscoveryItem): boolean {
  switch (item.action.type) {
    case "literature_search":
    case "deep_research":
    case "workbench_command":
    case "study_artifact_generate":
    case "document_generation_preset":
      return true;
    case "route":
      return routeShouldOpenAsWorkflow(item.action.route);
    default:
      return false;
  }
}

export function workflowPrompt(toolId: string): string {
  switch (toolId) {
    case "literature":
      return "현재 프로젝트 주제에 맞는 논문을 찾아서 후보를 정리하고, 가져올 만한 자료를 추천해줘.";
    case "research":
      return "현재 프로젝트 자료를 바탕으로 깊이 있는 리서치를 시작해줘. 필요한 외부 자료와 근거를 함께 찾아줘.";
    case "summarize":
      return "현재 프로젝트 자료를 핵심 개념, 근거, 시험/활용 포인트 중심으로 요약해줘.";
    case "paper_analysis":
      return "선택한 원본을 논문 읽기 기준으로 분석해줘. 연구 질문, 방법, 핵심 주장, 근거, 한계, 후속 질문을 섹션별로 정리하고 가능한 곳에는 인용 앵커를 붙여줘.";
    case "pdf_report_fast":
      return "현재 프로젝트 자료를 바탕으로 빠르게 공유할 수 있는 PDF 보고서를 만들어줘.";
    case "pdf_report_latex":
      return "현재 프로젝트 자료를 바탕으로 논문형 LaTeX PDF 보고서를 만들어줘.";
    case "docx_report":
      return "현재 프로젝트 자료를 바탕으로 편집 가능한 DOCX 보고서를 만들어줘.";
    case "pptx_deck":
      return "현재 프로젝트 자료를 발표자료 흐름으로 정리해줘.";
    case "xlsx_table":
      return "현재 프로젝트 자료를 비교 가능한 표와 스프레드시트로 정리해줘.";
    case "source_figure":
      return "현재 프로젝트 자료를 설명하는 핵심 피규어나 구조도를 만들어줘.";
    case "study_artifact_generator":
      return "현재 프로젝트 자료로 학습 자료를 만들어줘. 먼저 적절한 유형과 난이도를 제안해줘.";
    case "flashcards":
      return "현재 프로젝트 자료로 플래시카드를 만들어줘. 핵심 개념, 정의, 예시, 시험 포인트를 포함해줘.";
    case "teach_to_learn":
      return "현재 프로젝트 자료를 바탕으로 나에게 질문하면서 설명하는 Teach to Learn 세션을 시작해줘.";
    case "web_import":
      return "웹 URL을 현재 프로젝트 자료로 가져오고 요약까지 이어갈 수 있게 도와줘.";
    case "youtube_import":
      return "YouTube URL을 현재 프로젝트 자료로 가져오고 핵심 내용을 정리할 수 있게 도와줘.";
    default:
      return "현재 프로젝트 자료를 바탕으로 이 작업을 진행해줘.";
  }
}

function sourceArtifactFilename(title: string, suffix: string, extension: string) {
  const base = title
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${base || "source"}-${suffix}.${extension}`;
}

export function workflowForToolItem(
  item: ToolDiscoveryItem,
): Omit<AgentWorkflowIntent, "id"> {
  switch (item.action.type) {
    case "literature_search":
      return {
        kind: "literature_search",
        toolId: item.id,
        i18nKey: item.i18nKey,
        prompt: workflowPrompt(item.id),
      };
    case "study_artifact_generate":
      return {
        kind: "study_artifact",
        toolId: item.id,
        i18nKey: item.i18nKey,
        prompt: workflowPrompt(item.id),
        artifactType: item.action.artifactType,
      };
    case "document_generation_preset":
      return {
        kind: "document_generation",
        toolId: item.id,
        i18nKey: item.i18nKey,
        prompt: workflowPrompt(item.id),
        presetId: item.action.presetId,
      };
    case "route":
      return {
        kind:
          item.action.route === "project_learn_socratic"
            ? "teach_to_learn"
            : "agent_prompt",
        toolId: item.id,
        i18nKey: item.i18nKey,
        prompt: workflowPrompt(item.id),
        route: item.action.route,
      };
    default:
      return {
        kind: "agent_prompt",
        toolId: item.id,
        i18nKey: item.i18nKey,
        prompt: workflowPrompt(item.id),
      };
  }
}

export function workflowForSourceToolItem(
  item: ToolDiscoveryItem,
  source: { noteId: string; sourceTitle: string },
): Omit<AgentWorkflowIntent, "id"> {
  const base = workflowForToolItem(item);
  if (item.action.type === "document_generation_preset") {
    const preset = getDocumentGenerationPreset(item.action.presetId);
    const extension = preset.format === "image" ? "svg" : preset.format;
    const isPaperAnalysis = item.id === "paper_analysis";
    return {
      ...base,
      payload: {
        action: isPaperAnalysis
          ? "source_paper_analysis"
          : "source_document_generation",
        sourceIds: [`note:${source.noteId}`],
        sourceTitle: source.sourceTitle,
        initialPrompt: `${source.sourceTitle}를 대상으로: ${workflowPrompt(
          item.id,
        )}`,
        initialFilename: sourceArtifactFilename(
          source.sourceTitle,
          isPaperAnalysis ? "paper-analysis" : item.id.replace(/_/g, "-"),
          extension,
        ),
      },
    };
  }
  if (item.action.type === "study_artifact_generate") {
    return {
      ...base,
      payload: {
        sourceNoteIds: [source.noteId],
        sourceTitle: source.sourceTitle,
      },
    };
  }
  return base;
}
