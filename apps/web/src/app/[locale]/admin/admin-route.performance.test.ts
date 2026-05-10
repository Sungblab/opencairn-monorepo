import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("admin route bundle boundary", () => {
  it("keeps the admin page behind a dynamic client loader", () => {
    const source = read("src/app/[locale]/admin/page.tsx");

    expect(source).toContain("AdminUsersClientLoader");
    expect(source).not.toMatch(/from\s+["']\.\/AdminUsersClient["']/);
  });

  it("loads the admin client dynamically", () => {
    const loaderPath = "src/app/[locale]/admin/AdminUsersClientLoader.tsx";

    expect(existsSync(join(root, loaderPath))).toBe(true);
    const source = read(loaderPath);
    expect(source).toContain("next/dynamic");
    expect(source).toContain('import("./AdminUsersClient")');
  });
});
