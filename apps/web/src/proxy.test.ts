import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("proxy locale routing", () => {
  it("uses explicit locale prefixes so the root path redirects to a concrete locale", () => {
    const source = read("src/proxy.ts");

    expect(source).toContain('localePrefix: "always"');
    expect(source).not.toContain('localePrefix: "as-needed"');
  });

  it("keeps locale detection available for root visitors before choosing the explicit locale path", () => {
    const source = read("src/proxy.ts");

    expect(source).toContain("localeDetection: true");
  });
});
