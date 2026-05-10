import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("learn route bundle boundaries", () => {
  it("keeps the learn hub server card links off next/link runtime", () => {
    const hub = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/project/[projectId]/learn/page.tsx",
    );

    expect(hub).not.toContain("next/link");
    expect(hub).toContain("<a");
    expect(hub).toContain("href={s.href}");
  });

  it("keeps learn route pages as server entries with client implementations behind loaders", () => {
    const routes = [
      {
        path: "src/app/[locale]/workspace/[wsSlug]/(shell)/project/[projectId]/learn/socratic/page.tsx",
        loader: "SocraticSessionLoader",
        forbidden: "SocraticSession",
      },
      {
        path: "src/app/[locale]/workspace/[wsSlug]/(shell)/project/[projectId]/learn/flashcards/review/page.tsx",
        loader: "FlashcardReviewRouteLoader",
        forbidden: "FlashcardReview",
      },
      {
        path: "src/app/[locale]/workspace/[wsSlug]/(shell)/project/[projectId]/learn/scores/page.tsx",
        loader: "ScoresDashboardLoader",
        forbidden: "ScoresDashboard",
      },
      {
        path: "src/app/[locale]/workspace/[wsSlug]/(shell)/project/[projectId]/learn/flashcards/page.tsx",
        loader: "FlashcardDeckGridLoader",
        forbidden: "DeckCard",
      },
    ];

    for (const route of routes) {
      const source = read(route.path);
      expect(source).not.toMatch(/^"use client";/);
      expect(source).toContain(route.loader);
      expect(source).not.toMatch(
        new RegExp(`from\\s+["']@/components/learn/${route.forbidden}["']`),
      );
    }
  });

  it("loads heavy learn client components through dynamic route loaders", () => {
    for (const loaderPath of [
      "src/components/learn/SocraticSessionLoader.tsx",
      "src/components/learn/FlashcardReviewRouteLoader.tsx",
      "src/components/learn/ScoresDashboardLoader.tsx",
      "src/components/learn/FlashcardDeckGridLoader.tsx",
    ]) {
      expect(existsSync(join(root, loaderPath))).toBe(true);
      const loader = read(loaderPath);
      expect(loader).toContain("next/dynamic");
    }

    expect(read("src/components/learn/SocraticSessionLoader.tsx")).toContain(
      'import("./SocraticSession")',
    );
    expect(
      read("src/components/learn/FlashcardReviewRouteLoader.tsx"),
    ).toContain('import("./FlashcardReviewRoute")');
    expect(read("src/components/learn/ScoresDashboardLoader.tsx")).toContain(
      'import("./ScoresDashboard")',
    );
    expect(read("src/components/learn/FlashcardDeckGridLoader.tsx")).toContain(
      'import("./FlashcardDeckGrid")',
    );
  });

  it("keeps flashcard review labels server-resolved instead of client intl-bound", () => {
    const page = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/project/[projectId]/learn/flashcards/review/page.tsx",
    );
    const route = read("src/components/learn/FlashcardReviewRoute.tsx");
    const review = read("src/components/learn/FlashcardReview.tsx");
    const labelsPath = "src/components/learn/get-flashcard-review-labels.ts";

    expect(page).toContain("getFlashcardReviewLabels");
    expect(page).toContain("reviewLabels=");
    expect(existsSync(join(root, labelsPath))).toBe(true);
    expect(read(labelsPath)).toContain('getTranslations("learn.review")');

    for (const source of [route, review]) {
      expect(source).not.toContain("next-intl");
      expect(source).not.toContain("useTranslations");
    }
    expect(route).toContain("reviewLabels");
    expect(review).toContain("labels");
  });
});
