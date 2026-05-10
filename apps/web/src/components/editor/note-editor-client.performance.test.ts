import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("NoteEditorClient performance boundary", () => {
  it("loads the heavy NoteEditor through a route-level lazy boundary", () => {
    const source = read("src/components/editor/note-editor-client.tsx");

    expect(source).toContain("next/dynamic");
    expect(source).toContain('import("./NoteEditor")');
    expect(source).toMatch(/import\s+type\s+\{\s*NoteEditorProps\s*\}/);
    expect(source).not.toMatch(/import\s+\{\s*NoteEditor\s*,/);
  });
});
