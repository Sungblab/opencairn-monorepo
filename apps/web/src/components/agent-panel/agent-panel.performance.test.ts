import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("AgentPanel bundle boundary", () => {
  it("loads conversation rows and markdown rendering through secondary boundaries", () => {
    const conversation = read("src/components/agent-panel/conversation.tsx");
    const bubbleLoader = read(
      "src/components/agent-panel/message-bubble-loader.tsx",
    );
    const bubble = read("src/components/agent-panel/message-bubble.tsx");
    const rendererLoader = read(
      "src/components/chat/chat-message-renderer-loader.tsx",
    );

    expect(conversation).toContain("./message-bubble-loader");
    expect(conversation).not.toMatch(/from\s+["']\.\/message-bubble["']/);
    expect(bubbleLoader).toContain('import("./message-bubble")');
    expect(bubble).toContain("../chat/chat-message-renderer-loader");
    expect(bubble).not.toMatch(
      /from\s+["']\.\.\/chat\/chat-message-renderer["']/,
    );
    expect(rendererLoader).toContain('import("./chat-message-renderer")');
  });
});
