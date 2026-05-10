import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("public share route bundle boundaries", () => {
  it("keeps passive public-share CTAs off the next/link runtime", () => {
    for (const path of [
      "src/components/share/public-note-view.tsx",
      "src/app/[locale]/s/[token]/not-found.tsx",
    ]) {
      const source = read(path);

      expect(source).not.toContain("next/link");
      expect(source).toContain('href="/"');
    }
  });
});
