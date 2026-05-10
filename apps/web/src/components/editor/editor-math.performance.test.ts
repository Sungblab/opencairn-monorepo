import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("editor math performance boundaries", () => {
  it("uses local lightweight math node plugins instead of @platejs/math runtime entries", () => {
    const source = read("src/components/editor/plugins/latex.tsx");

    expect(source).not.toContain("@platejs/math");
    expect(source).toContain("createPlatePlugin");
    expect(source).toContain('key: "equation"');
    expect(source).toContain('key: "inline_equation"');
    expect(source).toContain("isVoid: true");
    expect(source).toContain("isInline: true");
  });

  it("keeps the KaTeX runtime behind a lazy renderer boundary", () => {
    for (const path of [
      "src/components/editor/elements/math-block.tsx",
      "src/components/editor/elements/math-inline.tsx",
      "src/components/editor/elements/math-edit-popover.tsx",
    ]) {
      const source = read(path);

      expect(source).not.toMatch(/from\s+["']katex["']/);
      expect(source).not.toContain("katex.renderToString");
    }

    const loaderPath =
      "src/components/editor/elements/katex-renderer-loader.tsx";
    const rendererPath =
      "src/components/editor/elements/katex-rendered-html.tsx";

    expect(existsSync(join(root, loaderPath))).toBe(true);
    expect(existsSync(join(root, rendererPath))).toBe(true);

    if (!existsSync(join(root, loaderPath)) || !existsSync(join(root, rendererPath))) {
      return;
    }

    expect(read(loaderPath)).toContain("next/dynamic");
    expect(read(loaderPath)).toContain('import("./katex-rendered-html")');
    expect(read(rendererPath)).toMatch(/from\s+["']katex["']/);
  });
});
