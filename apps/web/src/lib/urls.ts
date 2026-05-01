// Single source of truth for all in-app URL paths.
// Every component, hook, route, and test that builds an in-app URL should import from here.

const ws = (locale: string, slug: string) => `/${locale}/workspace/${slug}`;
const wsProject = (locale: string, slug: string, pid: string) =>
  `${ws(locale, slug)}/project/${pid}`;

export const urls = {
  dashboard: (locale: string) => `/${locale}/dashboard`,
  onboarding: (locale: string) => `/${locale}/onboarding`,

  settings: {
    ai: (locale: string) => `/${locale}/settings/ai`,
    mcp: (locale: string) => `/${locale}/settings/mcp`,
    billing: (locale: string) => `/${locale}/settings/billing`,
    notifications: (locale: string) => `/${locale}/settings/notifications`,
    profile: (locale: string) => `/${locale}/settings/profile`,
    providers: (locale: string) => `/${locale}/settings/providers`,
    security: (locale: string) => `/${locale}/settings/security`,
  },

  workspace: {
    root: (locale: string, slug: string) => ws(locale, slug),
    note: (locale: string, slug: string, noteId: string) =>
      `${ws(locale, slug)}/note/${noteId}`,
    project: (locale: string, slug: string, pid: string) => wsProject(locale, slug, pid),
    projectNote: (locale: string, slug: string, pid: string, nid: string) =>
      `${wsProject(locale, slug, pid)}/note/${nid}`,
    projectAgents: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/agents`,
    projectGraph: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/graph`,
    projectLearn: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/learn`,
    projectLearnFlashcards: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/learn/flashcards`,
    projectLearnFlashcardsReview: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/learn/flashcards/review`,
    projectLearnScores: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/learn/scores`,
    projectLearnSocratic: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/learn/socratic`,
    projectChatScope: (locale: string, slug: string, pid: string) =>
      `${wsProject(locale, slug, pid)}/chat-scope`,
    chatScope: (locale: string, slug: string) => `${ws(locale, slug)}/chat-scope`,
    research: (locale: string, slug: string) => `${ws(locale, slug)}/research`,
    researchRun: (locale: string, slug: string, runId: string) =>
      `${ws(locale, slug)}/research/${runId}`,
    settings: (locale: string, slug: string) => `${ws(locale, slug)}/settings`,
    settingsSection: (
      locale: string,
      slug: string,
      first: string,
      ...rest: string[]
    ) => `${ws(locale, slug)}/settings/${[first, ...rest].join("/")}`,
    synthesisExport: (locale: string, slug: string) =>
      `${ws(locale, slug)}/synthesis-export`,
    import: (locale: string, slug: string) => `${ws(locale, slug)}/import`,
    importJob: (locale: string, slug: string, jobId: string) =>
      `${ws(locale, slug)}/import/jobs/${jobId}`,
    newProject: (locale: string, slug: string) => `${ws(locale, slug)}/new-project`,
  },

  share: (token: string) => `/s/${token}`,
} as const;
