import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("canvas demo route bundle boundary", () => {
  it("keeps the canvas demo page as a server entry with a client loader", () => {
    const page = read("src/app/[locale]/canvas/demo/page.tsx");

    expect(page).not.toMatch(/^"use client";/);
    expect(page).toContain("CanvasDemoLoader");
    expect(page).not.toMatch(
      /from\s+["']@\/components\/canvas\/CanvasFrame["']/,
    );
  });

  it("loads the canvas demo client dynamically", () => {
    const loaderPath = "src/components/canvas/CanvasDemoLoader.tsx";

    expect(existsSync(join(root, loaderPath))).toBe(true);
    const loader = read(loaderPath);
    expect(loader).toContain("next/dynamic");
    expect(loader).toContain('import("./CanvasDemoClient")');
  });
});
