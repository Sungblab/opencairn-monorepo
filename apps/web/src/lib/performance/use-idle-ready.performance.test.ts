import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const hookPath = "src/lib/performance/use-idle-ready.ts";

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("idle readiness performance helper", () => {
  it("centralizes cancellable idle scheduling for non-critical lazy boundaries", () => {
    expect(existsSync(join(root, hookPath))).toBe(true);

    const source = read(hookPath);
    expect(source).toContain("export function useIdleReady");
    expect(source).toContain("requestIdleCallback");
    expect(source).toContain("cancelIdleCallback");
    expect(source).toContain("fallbackMs");
  });
});
