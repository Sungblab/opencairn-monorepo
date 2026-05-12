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

export type ProjectTemplateNote = {
  title: string;
  contentText: string;
};

export type ProjectTemplateProject = {
  name: string;
  description: string;
  notes: ProjectTemplateNote[];
};

export type ProjectTemplateDefinition = {
  id: ProjectTemplateId;
  category: ProjectTemplateCategory;
  projects: ProjectTemplateProject[];
};

const studyNotes = (subject: string): ProjectTemplateNote[] => [
  {
    title: `${subject} 자료 모음`,
    contentText: `${subject} 수업 자료, 프린트, 링크를 모아두는 노트입니다.`,
  },
  {
    title: `${subject} 핵심 개념`,
    contentText: `${subject}에서 반복해서 봐야 할 정의, 공식, 작품, 개념을 정리합니다.`,
  },
  {
    title: `${subject} 질문과 오답`,
    contentText: `${subject} 문제 풀이 중 헷갈린 부분과 다시 풀어야 할 오답을 기록합니다.`,
  },
  {
    title: `${subject} 시험 일정`,
    contentText: `${subject} 수행평가, 과제, 시험 범위와 마감일을 적어둡니다.`,
  },
];

const studyProject = (name: string): ProjectTemplateProject => ({
  name,
  description: `${name} 공부 자료와 노트를 한곳에 모읍니다.`,
  notes: studyNotes(name),
});

export const projectTemplates: ProjectTemplateDefinition[] = [
  {
    id: "empty_project",
    category: "blank",
    projects: [
      {
        name: "내 첫 프로젝트",
        description: "처음부터 직접 채워 나가는 빈 프로젝트입니다.",
        notes: [],
      },
    ],
  },
  {
    id: "school_subjects",
    category: "study",
    projects: ["국어", "수학", "영어", "과학"].map(studyProject),
  },
  {
    id: "korean",
    category: "study",
    projects: [studyProject("국어")],
  },
  {
    id: "math",
    category: "study",
    projects: [studyProject("수학")],
  },
  {
    id: "english",
    category: "study",
    projects: [studyProject("영어")],
  },
  {
    id: "science",
    category: "study",
    projects: [studyProject("과학")],
  },
  {
    id: "research",
    category: "research",
    projects: [
      {
        name: "리서치 프로젝트",
        description: "질문, 자료, 근거, 결론을 분리해 쌓는 조사 템플릿입니다.",
        notes: [
          {
            title: "리서치 질문",
            contentText: "이번 리서치에서 답해야 할 핵심 질문을 적습니다.",
          },
          {
            title: "자료와 출처",
            contentText: "논문, 웹 문서, 책, 인터뷰 등 확인한 출처를 모읍니다.",
          },
          {
            title: "결론 초안",
            contentText: "자료를 바탕으로 현재까지의 결론과 남은 불확실성을 정리합니다.",
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
        name: "회의 노트",
        description: "회의 안건, 결정사항, 후속 작업을 관리합니다.",
        notes: [
          {
            title: "이번 주 회의",
            contentText: "안건, 참석자, 논의 내용, 결정사항을 정리합니다.",
          },
          {
            title: "액션 아이템",
            contentText: "담당자, 마감일, 진행 상태를 기록합니다.",
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
        name: "개인 지식 창고",
        description: "읽은 것, 배운 것, 아이디어를 장기적으로 축적합니다.",
        notes: [
          {
            title: "읽은 것",
            contentText: "글, 책, 영상에서 남기고 싶은 내용을 기록합니다.",
          },
          {
            title: "아이디어",
            contentText: "나중에 확장하고 싶은 생각과 연결할 자료를 적습니다.",
          },
        ],
      },
    ],
  },
];

export function getProjectTemplate(
  id: ProjectTemplateId | string,
): ProjectTemplateDefinition | null {
  return projectTemplates.find((template) => template.id === id) ?? null;
}
