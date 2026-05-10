import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("global font payload", () => {
  it("keeps root font loading to the brand-critical faces", () => {
    const fonts = read("src/lib/landing/fonts.ts");
    const layout = read("src/app/layout.tsx");
    const landing = read("src/app/[locale]/page.tsx");
    const authLayout = read("src/app/[locale]/auth/layout.tsx");
    const onboardingLayout = read("src/app/[locale]/onboarding/layout.tsx");
    const globals = read("src/app/globals.css");

    expect(fonts).not.toContain("Inter");
    expect(fonts).not.toContain("JetBrains_Mono");
    expect(layout).not.toContain("inter");
    expect(layout).not.toContain("jetbrainsMono");
    expect(layout).not.toContain("instrumentSerif");
    expect(layout).not.toContain("pretendard.variable");
    expect(landing).toContain("instrumentSerif.variable");
    expect(authLayout).toContain("instrumentSerif.variable");
    expect(onboardingLayout).toContain("instrumentSerif.variable");
    expect(globals).toContain("pretendardvariable-dynamic-subset.css");
    expect(globals).toContain("\"Pretendard Variable\"");
    expect(globals).not.toContain("--font-sans-raw");
    expect(globals).not.toContain("--font-mono-raw");
  });
});
