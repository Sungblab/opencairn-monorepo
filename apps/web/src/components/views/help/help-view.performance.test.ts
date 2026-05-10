import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("help view bundle boundaries", () => {
  it("keeps help action links off the next/link runtime", () => {
    const source = read("src/components/views/help/help-view.tsx");

    expect(source).not.toContain("next/link");
    expect(source).toContain("<a");
    expect(source).toContain("href={actionHrefs[key]}");
  });
});
