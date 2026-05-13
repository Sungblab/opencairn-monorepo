import { z } from "zod";

export const projectTemplateIdSchema = z.enum([
  "empty_project",
  "research",
  "source_library",
  "meeting",
  "personal_knowledge",
  "team_project",
]);

export type ProjectTemplateId = z.infer<typeof projectTemplateIdSchema>;

export const projectTemplateApplyRequestSchema = z.object({
  templateId: projectTemplateIdSchema,
});

export type ProjectTemplateApplyRequest = z.infer<
  typeof projectTemplateApplyRequestSchema
>;

export type ProjectTemplateCategory = "blank" | "study" | "research" | "work" | "personal";
export type ProjectTemplateLocale = "ko" | "en";

export type ProjectTemplateNoteDefinition = {
  id: string;
  titleKey: string;
  contentTextKey: string;
};

export type ProjectTemplateProjectDefinition = {
  id: string;
  nameKey: string;
  descriptionKey: string;
  params?: Record<string, string>;
  notes: ProjectTemplateNoteDefinition[];
};

export type ProjectTemplateDefinition = {
  id: ProjectTemplateId;
  category: ProjectTemplateCategory;
  projects: ProjectTemplateProjectDefinition[];
};

export type ProjectTemplateNote = {
  title: string;
  contentText: string;
};

export type ProjectTemplateProject = {
  name: string;
  description: string;
  notes: ProjectTemplateNote[];
};

export type ResolvedProjectTemplateDefinition = {
  id: ProjectTemplateId;
  category: ProjectTemplateCategory;
  projects: ProjectTemplateProject[];
};

export const projectTemplates: ProjectTemplateDefinition[] = [
  {
    id: "empty_project",
    category: "blank",
    projects: [
      {
        id: "empty",
        nameKey: "emptyProject.name",
        descriptionKey: "emptyProject.description",
        notes: [],
      },
    ],
  },
  {
    id: "research",
    category: "research",
    projects: [
      {
        id: "research",
        nameKey: "research.project.name",
        descriptionKey: "research.project.description",
        notes: [
          {
            id: "question",
            titleKey: "research.notes.question.title",
            contentTextKey: "research.notes.question.contentText",
          },
          {
            id: "sources",
            titleKey: "research.notes.sources.title",
            contentTextKey: "research.notes.sources.contentText",
          },
          {
            id: "draft",
            titleKey: "research.notes.draft.title",
            contentTextKey: "research.notes.draft.contentText",
          },
        ],
      },
    ],
  },
  {
    id: "source_library",
    category: "research",
    projects: [
      {
        id: "sourceLibrary",
        nameKey: "sourceLibrary.project.name",
        descriptionKey: "sourceLibrary.project.description",
        notes: [
          {
            id: "inbox",
            titleKey: "sourceLibrary.notes.inbox.title",
            contentTextKey: "sourceLibrary.notes.inbox.contentText",
          },
          {
            id: "claims",
            titleKey: "sourceLibrary.notes.claims.title",
            contentTextKey: "sourceLibrary.notes.claims.contentText",
          },
          {
            id: "openQuestions",
            titleKey: "sourceLibrary.notes.openQuestions.title",
            contentTextKey: "sourceLibrary.notes.openQuestions.contentText",
          },
        ],
      },
    ],
  },
  {
    id: "meeting",
    category: "work",
    projects: [
      {
        id: "meeting",
        nameKey: "meeting.project.name",
        descriptionKey: "meeting.project.description",
        notes: [
          {
            id: "weekly",
            titleKey: "meeting.notes.weekly.title",
            contentTextKey: "meeting.notes.weekly.contentText",
          },
          {
            id: "actions",
            titleKey: "meeting.notes.actions.title",
            contentTextKey: "meeting.notes.actions.contentText",
          },
        ],
      },
    ],
  },
  {
    id: "personal_knowledge",
    category: "personal",
    projects: [
      {
        id: "personalKnowledge",
        nameKey: "personalKnowledge.project.name",
        descriptionKey: "personalKnowledge.project.description",
        notes: [
          {
            id: "reading",
            titleKey: "personalKnowledge.notes.reading.title",
            contentTextKey: "personalKnowledge.notes.reading.contentText",
          },
          {
            id: "ideas",
            titleKey: "personalKnowledge.notes.ideas.title",
            contentTextKey: "personalKnowledge.notes.ideas.contentText",
          },
        ],
      },
    ],
  },
  {
    id: "team_project",
    category: "work",
    projects: [
      {
        id: "teamProject",
        nameKey: "teamProject.project.name",
        descriptionKey: "teamProject.project.description",
        notes: [
          {
            id: "brief",
            titleKey: "teamProject.notes.brief.title",
            contentTextKey: "teamProject.notes.brief.contentText",
          },
          {
            id: "decisions",
            titleKey: "teamProject.notes.decisions.title",
            contentTextKey: "teamProject.notes.decisions.contentText",
          },
          {
            id: "risks",
            titleKey: "teamProject.notes.risks.title",
            contentTextKey: "teamProject.notes.risks.contentText",
          },
        ],
      },
    ],
  },
];

export const projectTemplateCopy: Record<ProjectTemplateLocale, Record<string, string>> = {
  ko: {
    "emptyProject.name": "새 프로젝트",
    "emptyProject.description": "이름만 정하고 바로 시작하는 빈 프로젝트입니다.",
    "research.project.name": "리서치 프로젝트",
    "research.project.description": "질문, 자료, 근거, 결론을 분리해 쌓는 조사 프로젝트입니다.",
    "research.notes.question.title": "리서치 질문",
    "research.notes.question.contentText": "이번 리서치에서 답해야 할 핵심 질문을 적습니다.",
    "research.notes.sources.title": "자료와 출처",
    "research.notes.sources.contentText": "논문, 웹 문서, 책, 인터뷰 등 확인한 출처를 모읍니다.",
    "research.notes.draft.title": "결론 초안",
    "research.notes.draft.contentText":
      "자료를 바탕으로 현재까지의 결론과 남은 불확실성을 정리합니다.",
    "sourceLibrary.project.name": "자료 분석 프로젝트",
    "sourceLibrary.project.description": "PDF, 웹 문서, 메모에서 근거와 쟁점을 뽑아 정리합니다.",
    "sourceLibrary.notes.inbox.title": "자료 인박스",
    "sourceLibrary.notes.inbox.contentText": "읽어야 할 파일, 링크, 원문 메모를 모읍니다.",
    "sourceLibrary.notes.claims.title": "핵심 주장과 근거",
    "sourceLibrary.notes.claims.contentText": "자료별 핵심 주장, 근거, 인용할 문장을 정리합니다.",
    "sourceLibrary.notes.openQuestions.title": "확인할 질문",
    "sourceLibrary.notes.openQuestions.contentText": "아직 검증하지 못한 주장과 추가로 찾아볼 자료를 적습니다.",
    "meeting.project.name": "회의 노트",
    "meeting.project.description": "회의 안건, 결정사항, 후속 작업을 관리합니다.",
    "meeting.notes.weekly.title": "이번 주 회의",
    "meeting.notes.weekly.contentText": "안건, 참석자, 논의 내용, 결정사항을 정리합니다.",
    "meeting.notes.actions.title": "액션 아이템",
    "meeting.notes.actions.contentText": "담당자, 마감일, 진행 상태를 기록합니다.",
    "personalKnowledge.project.name": "개인 지식 창고",
    "personalKnowledge.project.description": "읽은 것, 배운 것, 아이디어를 장기적으로 축적합니다.",
    "personalKnowledge.notes.reading.title": "읽은 것",
    "personalKnowledge.notes.reading.contentText": "글, 책, 영상에서 남기고 싶은 내용을 기록합니다.",
    "personalKnowledge.notes.ideas.title": "아이디어",
    "personalKnowledge.notes.ideas.contentText": "나중에 확장하고 싶은 생각과 연결할 자료를 적습니다.",
    "teamProject.project.name": "팀 프로젝트",
    "teamProject.project.description": "목표, 결정사항, 리스크를 한 프로젝트에서 맞춰 봅니다.",
    "teamProject.notes.brief.title": "프로젝트 브리프",
    "teamProject.notes.brief.contentText": "목표, 범위, 성공 기준, 주요 이해관계자를 정리합니다.",
    "teamProject.notes.decisions.title": "결정 로그",
    "teamProject.notes.decisions.contentText": "결정한 내용, 이유, 되돌아볼 조건을 기록합니다.",
    "teamProject.notes.risks.title": "리스크와 다음 액션",
    "teamProject.notes.risks.contentText": "막힌 점, 책임자, 다음 액션, 마감일을 관리합니다.",
  },
  en: {
    "emptyProject.name": "New project",
    "emptyProject.description": "A blank project you can name and start immediately.",
    "research.project.name": "Research Project",
    "research.project.description": "Separate questions, sources, evidence, and conclusions as you research.",
    "research.notes.question.title": "Research Question",
    "research.notes.question.contentText": "Write the core question this research should answer.",
    "research.notes.sources.title": "Sources",
    "research.notes.sources.contentText":
      "Collect papers, web pages, books, interviews, and other checked sources.",
    "research.notes.draft.title": "Draft Conclusion",
    "research.notes.draft.contentText":
      "Summarize the current conclusion and remaining uncertainty from the evidence.",
    "sourceLibrary.project.name": "Source analysis project",
    "sourceLibrary.project.description": "Extract claims, evidence, and open questions from source material.",
    "sourceLibrary.notes.inbox.title": "Source inbox",
    "sourceLibrary.notes.inbox.contentText": "Collect files, links, and raw notes to review.",
    "sourceLibrary.notes.claims.title": "Claims and evidence",
    "sourceLibrary.notes.claims.contentText": "Track key claims, supporting evidence, and quotable passages.",
    "sourceLibrary.notes.openQuestions.title": "Open questions",
    "sourceLibrary.notes.openQuestions.contentText": "List unverified claims and sources to find next.",
    "meeting.project.name": "Meeting Notes",
    "meeting.project.description": "Manage agendas, decisions, and follow-up work.",
    "meeting.notes.weekly.title": "This Week's Meeting",
    "meeting.notes.weekly.contentText": "Capture agenda, attendees, discussion, and decisions.",
    "meeting.notes.actions.title": "Action Items",
    "meeting.notes.actions.contentText": "Track owners, due dates, and status.",
    "personalKnowledge.project.name": "Personal Knowledge Base",
    "personalKnowledge.project.description": "Accumulate what you read, learn, and think over time.",
    "personalKnowledge.notes.reading.title": "Reading",
    "personalKnowledge.notes.reading.contentText": "Record useful ideas from articles, books, and videos.",
    "personalKnowledge.notes.ideas.title": "Ideas",
    "personalKnowledge.notes.ideas.contentText": "Capture thoughts and related materials to expand later.",
    "teamProject.project.name": "Team project",
    "teamProject.project.description": "Align goals, decisions, risks, and next actions in one project.",
    "teamProject.notes.brief.title": "Project brief",
    "teamProject.notes.brief.contentText": "Define goals, scope, success criteria, and stakeholders.",
    "teamProject.notes.decisions.title": "Decision log",
    "teamProject.notes.decisions.contentText": "Record decisions, rationale, and revisit conditions.",
    "teamProject.notes.risks.title": "Risks and next actions",
    "teamProject.notes.risks.contentText": "Track blockers, owners, next actions, and due dates.",
  },
};

export function normalizeProjectTemplateLocale(locale?: string | null): ProjectTemplateLocale {
  const normalized = locale?.toLowerCase();
  if (normalized?.startsWith("en")) return "en";
  return "ko";
}

export function getProjectTemplate(
  id: ProjectTemplateId | string,
): ProjectTemplateDefinition | null {
  return projectTemplates.find((template) => template.id === id) ?? null;
}

export function getResolvedProjectTemplate(
  id: ProjectTemplateId | string,
  locale?: string | null,
): ResolvedProjectTemplateDefinition | null {
  const template = getProjectTemplate(id);
  if (!template) return null;
  return resolveProjectTemplate(template, locale);
}

export function resolveProjectTemplate(
  template: ProjectTemplateDefinition,
  locale?: string | null,
): ResolvedProjectTemplateDefinition {
  const normalizedLocale = normalizeProjectTemplateLocale(locale);

  const resolveText = (key: string, params?: Record<string, string>) => {
    const copy = projectTemplateCopy[normalizedLocale][key] ?? projectTemplateCopy.ko[key] ?? key;
    if (!params) return copy;
    return copy.replace(/\{(\w+)\}/g, (_match, paramName: string) => params[paramName] ?? "");
  };

  const resolveParams = (params?: Record<string, string>) => {
    if (!params) return undefined;
    return Object.fromEntries(
      Object.entries(params).map(([name, key]) => [name, resolveText(key)]),
    );
  };

  return {
    id: template.id,
    category: template.category,
    projects: template.projects.map((project) => {
      const params = resolveParams(project.params);
      return {
        name: resolveText(project.nameKey, params),
        description: resolveText(project.descriptionKey, params),
        notes: project.notes.map((note) => ({
          title: resolveText(note.titleKey, params),
          contentText: resolveText(note.contentTextKey, params),
        })),
      };
    }),
  };
}
