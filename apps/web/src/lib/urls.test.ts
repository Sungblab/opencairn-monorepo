import { describe, expect, it } from "vitest";

import { urls } from "./urls";

describe("urls", () => {
  describe("app-level", () => {
    it("dashboard", () => {
      expect(urls.dashboard("ko")).toBe("/ko/dashboard");
      expect(urls.dashboard("en")).toBe("/en/dashboard");
    });

    it("onboarding", () => {
      expect(urls.onboarding("ko")).toBe("/ko/onboarding");
    });
  });

  describe("settings", () => {
    it("each section", () => {
      expect(urls.settings.ai("ko")).toBe("/ko/settings/ai");
      expect(urls.settings.mcp("ko")).toBe("/ko/settings/mcp");
      expect(urls.settings.billing("ko")).toBe("/ko/settings/billing");
      expect(urls.settings.notifications("ko")).toBe(
        "/ko/settings/notifications",
      );
      expect(urls.settings.profile("ko")).toBe("/ko/settings/profile");
      expect(urls.settings.providers("ko")).toBe("/ko/settings/providers");
      expect(urls.settings.security("ko")).toBe("/ko/settings/security");
    });
  });

  describe("workspace", () => {
    it("root", () => {
      expect(urls.workspace.root("ko", "acme")).toBe("/ko/workspace/acme");
    });

    it("note", () => {
      expect(urls.workspace.note("ko", "acme", "n123")).toBe(
        "/ko/workspace/acme/note/n123",
      );
    });

    it("project", () => {
      expect(urls.workspace.project("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1",
      );
    });

    it("projectNote", () => {
      expect(urls.workspace.projectNote("ko", "acme", "p1", "n2")).toBe(
        "/ko/workspace/acme/project/p1/note/n2",
      );
    });

    it("project sub-routes", () => {
      expect(urls.workspace.projectAgents("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/agents",
      );
      expect(urls.workspace.projectGraph("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/graph",
      );
      expect(urls.workspace.projectLearn("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/learn",
      );
      expect(urls.workspace.projectLearnFlashcards("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/learn/flashcards",
      );
      expect(
        urls.workspace.projectLearnFlashcardsReview("ko", "acme", "p1"),
      ).toBe("/ko/workspace/acme/project/p1/learn/flashcards/review");
      expect(urls.workspace.projectLearnScores("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/learn/scores",
      );
      expect(urls.workspace.projectLearnSocratic("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/learn/socratic",
      );
      expect(urls.workspace.projectChatScope("ko", "acme", "p1")).toBe(
        "/ko/workspace/acme/project/p1/chat-scope",
      );
    });

    it("workspace-level features", () => {
      expect(urls.workspace.chatScope("ko", "acme")).toBe(
        "/ko/workspace/acme/chat-scope",
      );
      expect(urls.workspace.research("ko", "acme")).toBe(
        "/ko/workspace/acme/research",
      );
      expect(urls.workspace.researchRun("ko", "acme", "r1")).toBe(
        "/ko/workspace/acme/research/r1",
      );
      expect(urls.workspace.settings("ko", "acme")).toBe(
        "/ko/workspace/acme/settings",
      );
      expect(urls.workspace.settingsSection("ko", "acme", "members")).toBe(
        "/ko/workspace/acme/settings/members",
      );
      expect(
        urls.workspace.settingsSection("ko", "acme", "members", "invites"),
      ).toBe("/ko/workspace/acme/settings/members/invites");
      expect(urls.workspace.synthesisExport("ko", "acme")).toBe(
        "/ko/workspace/acme/synthesis-export",
      );
      expect(urls.workspace.import("ko", "acme")).toBe(
        "/ko/workspace/acme/import",
      );
      expect(urls.workspace.importJob("ko", "acme", "job-1")).toBe(
        "/ko/workspace/acme/import/jobs/job-1",
      );
      expect(urls.workspace.newProject("ko", "acme")).toBe(
        "/ko/workspace/acme/new-project",
      );
    });
  });

  describe("share", () => {
    it("locale-less by design", () => {
      expect(urls.share("tok-abc")).toBe("/s/tok-abc");
    });
  });
});
