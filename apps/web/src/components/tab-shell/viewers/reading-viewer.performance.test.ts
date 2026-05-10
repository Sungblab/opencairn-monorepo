import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("ReadingViewer bundle boundary", () => {
  it("keeps the Plate reader body behind a lazy boundary", () => {
    const host = read("src/components/tab-shell/viewers/reading-viewer.tsx");
    const body = read(
      "src/components/tab-shell/viewers/reading-viewer-body.tsx",
    );

    expect(host).toContain("next/dynamic");
    expect(host).toContain("./reading-viewer-body");
    expect(host).not.toMatch(/from\s+["']platejs\/react["']/);
    expect(host).not.toMatch(/@platejs\/basic-nodes\/react/);
    expect(host).not.toMatch(/@platejs\/list\/react/);
    expect(host).not.toMatch(/@\/hooks\/useCollaborativeEditor/);
    expect(host).not.toMatch(/@\/components\/editor\/plugins\/latex/);

    expect(body).toContain("useCollaborativeEditor");
    expect(body).toContain("PlateContent");
  });
});
