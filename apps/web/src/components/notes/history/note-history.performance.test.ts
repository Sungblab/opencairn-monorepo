import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("note history performance boundaries", () => {
  it("keeps the history sheet and static preview out of the initial chrome button", () => {
    const button = read(
      "src/components/notes/history/note-history-button.tsx",
    );
    const sheet = read("src/components/notes/history/note-history-sheet.tsx");
    const loaderPath =
      "src/components/notes/history/note-history-sheet-loader.tsx";

    expect(button).not.toMatch(/from\s+["']\.\/note-history-sheet["']/);
    expect(button).toContain("./note-history-sheet-loader");
    expect(sheet).toContain("./version-preview");
    expect(sheet).not.toContain("@/components/share/plate-static-renderer");

    expect(existsSync(join(root, loaderPath))).toBe(true);
    if (!existsSync(join(root, loaderPath))) return;

    const loader = read(loaderPath);

    expect(loader).toContain("next/dynamic");
    expect(loader).toContain('import("./note-history-sheet")');
  });
});
