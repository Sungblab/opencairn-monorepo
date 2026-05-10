import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("Chat scope route bundle boundary", () => {
  it("loads the chat panel through a route-level loader", () => {
    const projectPage = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/project/[projectId]/chat-scope/page.tsx",
    );
    const workspacePage = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/chat-scope/page.tsx",
    );

    for (const page of [projectPage, workspacePage]) {
      expect(page).not.toContain('"use client"');
      expect(page).not.toMatch(
        /from\s+["']@\/components\/chat-scope\/ChatPanel["']/,
      );
      expect(page).toContain("@/components/chat-scope/ChatPanelLoader");
    }

    const loader = read("src/components/chat-scope/ChatPanelLoader.tsx");
    expect(loader).toContain("dynamic");
    expect(loader).toContain('import("./ChatPanel")');
    expect(loader).toContain("ChatPanelSkeleton");
  });
});
