import { z } from "zod";

export const projectTemplateIdSchema = z.enum([
  "empty_project",
  "school_subjects",
  "korean",
  "math",
  "english",
  "science",
  "research",
  "meeting",
  "personal_knowledge",
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

const studyNoteDefinitions: ProjectTemplateNoteDefinition[] = [
  {
    id: "materials",
    titleKey: "study.notes.materials.title",
    contentTextKey: "study.notes.materials.contentText",
  },
  {
    id: "concepts",
    titleKey: "study.notes.concepts.title",
    contentTextKey: "study.notes.concepts.contentText",
  },
  {
    id: "questions",
    titleKey: "study.notes.questions.title",
    contentTextKey: "study.notes.questions.contentText",
  },
  {
    id: "schedule",
    titleKey: "study.notes.schedule.title",
    contentTextKey: "study.notes.schedule.contentText",
  },
];

const studyProject = (
  id: "korean" | "math" | "english" | "science",
): ProjectTemplateProjectDefinition => ({
  id,
  nameKey: `subjects.${id}.name`,
  descriptionKey: "study.project.description",
  params: { subject: `subjects.${id}.name` },
  notes: studyNoteDefinitions,
});

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
    id: "school_subjects",
    category: "study",
    projects: [
      studyProject("korean"),
      studyProject("math"),
      studyProject("english"),
      studyProject("science"),
    ],
  },
  {
    id: "korean",
    category: "study",
    projects: [studyProject("korean")],
  },
  {
    id: "math",
    category: "study",
    projects: [studyProject("math")],
  },
  {
    id: "english",
    category: "study",
    projects: [studyProject("english")],
  },
  {
    id: "science",
    category: "study",
    projects: [studyProject("science")],
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
];

export const projectTemplateCopy: Record<ProjectTemplateLocale, Record<string, string>> = {
  ko: {
    "emptyProject.name": "내 첫 프로젝트",
    "emptyProject.description": "처음부터 직접 채워 나가는 빈 프로젝트입니다.",
    "subjects.korean.name": "국어",
    "subjects.math.name": "수학",
    "subjects.english.name": "영어",
    "subjects.science.name": "과학",
    "study.project.description": "{subject} 공부 자료와 노트를 한곳에 모읍니다.",
    "study.notes.materials.title": "{subject} 자료 모음",
    "study.notes.materials.contentText": "{subject} 수업 자료, 프린트, 링크를 모아두는 노트입니다.",
    "study.notes.concepts.title": "{subject} 핵심 개념",
    "study.notes.concepts.contentText":
      "{subject}에서 반복해서 봐야 할 정의, 공식, 작품, 개념을 정리합니다.",
    "study.notes.questions.title": "{subject} 질문과 오답",
    "study.notes.questions.contentText":
      "{subject} 문제 풀이 중 헷갈린 부분과 다시 풀어야 할 오답을 기록합니다.",
    "study.notes.schedule.title": "{subject} 시험 일정",
    "study.notes.schedule.contentText": "{subject} 수행평가, 과제, 시험 범위와 마감일을 적어둡니다.",
    "research.project.name": "리서치 프로젝트",
    "research.project.description": "질문, 자료, 근거, 결론을 분리해 쌓는 조사 템플릿입니다.",
    "research.notes.question.title": "리서치 질문",
    "research.notes.question.contentText": "이번 리서치에서 답해야 할 핵심 질문을 적습니다.",
    "research.notes.sources.title": "자료와 출처",
    "research.notes.sources.contentText": "논문, 웹 문서, 책, 인터뷰 등 확인한 출처를 모읍니다.",
    "research.notes.draft.title": "결론 초안",
    "research.notes.draft.contentText":
      "자료를 바탕으로 현재까지의 결론과 남은 불확실성을 정리합니다.",
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
  },
  en: {
    "emptyProject.name": "My First Project",
    "emptyProject.description": "A blank project you can shape from scratch.",
    "subjects.korean.name": "Korean",
    "subjects.math.name": "Math",
    "subjects.english.name": "English",
    "subjects.science.name": "Science",
    "study.project.description": "Collect {subject} study materials and notes in one place.",
    "study.notes.materials.title": "{subject} Materials",
    "study.notes.materials.contentText": "Collect {subject} handouts, links, and class materials here.",
    "study.notes.concepts.title": "{subject} Core Concepts",
    "study.notes.concepts.contentText":
      "Summarize the definitions, formulas, works, and concepts you need to revisit.",
    "study.notes.questions.title": "{subject} Questions and Mistakes",
    "study.notes.questions.contentText":
      "Track confusing problems, wrong answers, and parts you should solve again.",
    "study.notes.schedule.title": "{subject} Exam Schedule",
    "study.notes.schedule.contentText": "Record assignments, performance tasks, exam scope, and due dates.",
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
