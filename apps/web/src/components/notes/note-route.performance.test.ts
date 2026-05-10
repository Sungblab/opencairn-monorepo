import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("note route bundle boundaries", () => {
  it("keeps the shell note page behind a single dynamic note route client", () => {
    const page = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/note/[noteId]/page.tsx",
    );

    expect(page).toContain("NoteRouteClientLoader");
    expect(page).not.toMatch(
      /from\s+["']@\/components\/editor\/note-editor-client["']/,
    );
    expect(page).not.toMatch(
      /from\s+["']@\/components\/notes\/NoteWithBacklinks["']/,
    );
    expect(page).not.toMatch(
      /from\s+["']@\/components\/notes\/NoteRouteChrome["']/,
    );
    expect(page).not.toMatch(
      /from\s+["']@\/components\/notes\/NoteTabModeSync["']/,
    );

    const loaderPath = "src/components/notes/NoteRouteClientLoader.tsx";
    expect(existsSync(join(root, loaderPath))).toBe(true);
    const loader = read(loaderPath);
    expect(loader).toContain("next/dynamic");
    expect(loader).toContain('import("./NoteRouteClient")');
  });

  it("keeps the legacy project note page behind the same dynamic note route client", () => {
    const page = read(
      "src/app/[locale]/workspace/[wsSlug]/project/[projectId]/note/[noteId]/page.tsx",
    );

    expect(page).toContain("NoteRouteClientLoader");
    expect(page).not.toMatch(
      /from\s+["']@\/components\/editor\/note-editor-client["']/,
    );
    expect(page).not.toMatch(
      /from\s+["']@\/components\/notes\/NoteRouteClient["']/,
    );
    expect(page).toContain("sourceType");
    expect(page).toContain("updatedAt");
  });

  it("keeps legacy note not-found chrome off the next/link runtime", () => {
    const notFound = read(
      "src/app/[locale]/workspace/[wsSlug]/project/[projectId]/note/[noteId]/not-found.tsx",
    );

    expect(notFound).not.toContain("next/link");
    expect(notFound).toContain('<a href="/"');
  });

  it("keeps optional note side panels behind lazy loaders", () => {
    const source = read("src/components/notes/NoteWithBacklinks.tsx");

    expect(source).toContain("BacklinksPanelLoader");
    expect(source).toContain("EnrichmentPanelLoader");
    expect(source).not.toMatch(/from\s+["']\.\/BacklinksPanel["']/);
    expect(source).not.toMatch(/from\s+["']\.\/EnrichmentPanel["']/);
  });

  it("loads optional note side panels dynamically", () => {
    for (const loaderPath of [
      "src/components/notes/BacklinksPanelLoader.tsx",
      "src/components/notes/EnrichmentPanelLoader.tsx",
    ]) {
      expect(existsSync(join(root, loaderPath))).toBe(true);
      const loader = read(loaderPath);
      expect(loader).toContain("next/dynamic");
    }

    expect(read("src/components/notes/BacklinksPanelLoader.tsx")).toContain(
      'import("./BacklinksPanel")',
    );
    expect(read("src/components/notes/EnrichmentPanelLoader.tsx")).toContain(
      'import("./EnrichmentPanel")',
    );
  });
});
