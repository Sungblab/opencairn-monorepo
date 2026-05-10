import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("ChatMessageRenderer bundle boundary", () => {
  it("defers syntax highlighting until a fenced code block renders", () => {
    const codeBlock = read("src/components/chat/renderers/code-block.tsx");
    const syntaxBlock = read(
      "src/components/chat/renderers/syntax-code-block.tsx",
    );

    expect(codeBlock).not.toContain("react-syntax-highlighter");
    expect(codeBlock).toContain('import("./syntax-code-block")');
    expect(syntaxBlock).toContain("react-syntax-highlighter");
    expect(syntaxBlock).toContain("prism-light");
    expect(syntaxBlock).toContain("registerLanguage");
    expect(syntaxBlock).not.toContain("Prism as SyntaxHighlighter");
  });

  it("defers math plugins and KaTeX CSS until the message contains math", () => {
    const renderer = read("src/components/chat/chat-message-renderer.tsx");
    const mathPlugins = read(
      "src/components/chat/markdown-math-plugins.ts",
    );

    expect(renderer).not.toContain("remark-math");
    expect(renderer).not.toContain("rehype-katex");
    expect(renderer).not.toContain("katex/dist/katex.min.css");
    expect(renderer).toContain('import("./markdown-math-plugins")');
    expect(mathPlugins).toContain("remark-math");
    expect(mathPlugins).toContain("rehype-katex");
    expect(mathPlugins).toContain("katex/dist/katex.min.css");
  });
});
