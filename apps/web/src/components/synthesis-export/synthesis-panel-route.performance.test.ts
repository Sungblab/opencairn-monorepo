import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("Synthesis export route bundle boundary", () => {
  it("loads the synthesis panel through a route-level loader", () => {
    const page = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/synthesis-export/page.tsx",
    );

    expect(page).not.toMatch(
      /from\s+["']@\/components\/synthesis-export\/SynthesisPanel["']/,
    );
    expect(page).toContain(
      "@/components/synthesis-export/SynthesisPanelLoader",
    );

    const loader = read("src/components/synthesis-export/SynthesisPanelLoader.tsx");
    expect(loader).toContain("dynamic<SynthesisPanelProps>");
    expect(loader).toContain('import("./SynthesisPanel")');
    expect(loader).toContain("SynthesisPanelSkeleton");
  });
});
