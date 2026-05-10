import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("ChatPanel bundle boundary", () => {
  it("defers save_suggestion schema and tab creation helpers until they are needed", () => {
    const panel = read("src/components/chat-scope/ChatPanel.tsx");

    expect(panel).not.toMatch(/import\s+\{[^}]*saveSuggestionSchema[^}]*\}\s+from\s+["']@opencairn\/shared["']/s);
    expect(panel).not.toMatch(/from\s+["']@\/lib\/tab-factory["']/);
    expect(panel).toContain('import("@opencairn/shared")');
    expect(panel).toContain('import("@/lib/tab-factory")');
  });

  it("keeps attachment card renderers behind a lazy boundary", () => {
    const panel = read("src/components/chat-scope/ChatPanel.tsx");
    const loader = read("src/components/chat-scope/ChatAttachmentCardsLoader.tsx");
    const cardsPanel = read(
      "src/components/chat-scope/ChatAttachmentCardsPanel.tsx",
    );

    expect(panel).toContain("./ChatAttachmentCardsLoader");
    expect(panel).not.toMatch(
      /from\s+["']\.\.\/agent-panel\/message-bubble["']/,
    );
    expect(loader).toContain('import("./ChatAttachmentCardsPanel")');
    expect(cardsPanel).toContain("../agent-panel/message-attachments");
    expect(cardsPanel).not.toMatch(
      /from\s+["']\.\.\/agent-panel\/message-bubble["']/,
    );
  });
});
