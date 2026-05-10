import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const scriptPath = path.join(webRoot, "scripts/route-client-manifest-size.mjs");

function writeBytes(filePath: string, byteCount: number) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "x".repeat(byteCount));
}

describe("route client manifest size script", () => {
  it("is exposed through the web package scripts", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(webRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["perf:routes"]).toBe(
      "node scripts/route-client-manifest-size.mjs",
    );
  });

  it("sums unique existing route chunks and resolves encoded manifest paths", () => {
    const root = mkdtempSync(path.join(tmpdir(), "opencairn-web-route-size-"));
    const nextRoot = path.join(root, ".next");
    const manifestDir = path.join(nextRoot, "server/app/[locale]");

    mkdirSync(path.join(manifestDir, "admin"), { recursive: true });
    writeBytes(path.join(nextRoot, "static/chunks/shared.js"), 10);
    writeBytes(path.join(nextRoot, "static/chunks/app/[locale]/page.js"), 5);

    writeFileSync(
      path.join(manifestDir, "page_client-reference-manifest.js"),
      'globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/[locale]/page"]={"clientModules":{"a":{"chunks":["100","static/chunks/shared.js","200","static/chunks/app/%5Blocale%5D/page.js"]},"b":{"chunks":["100","static/chunks/shared.js"]}}};',
    );
    writeFileSync(
      path.join(manifestDir, "admin/page_client-reference-manifest.js"),
      'globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/[locale]/admin/page"]={"clientModules":{"a":{"chunks":["100","static/chunks/shared.js"]}}};',
    );

    const output = execFileSync(
      process.execPath,
      [scriptPath, "--", "--root", root, "--limit", "2"],
      { encoding: "utf8" },
    );

    expect(output).toContain("bytes chunks missing route");
    expect(output).toContain("15 2 0 /[locale]/page");
    expect(output).toContain("10 1 0 /[locale]/admin/page");
  });

  it("rejects flags that are missing values", () => {
    for (const args of [
      ["--root"],
      ["--root", "--json"],
      ["--limit"],
      ["--limit", "--json"],
    ]) {
      expect(() =>
        execFileSync(process.execPath, [scriptPath, ...args], {
          encoding: "utf8",
          stdio: "pipe",
        }),
      ).toThrow(/requires a value/);
    }
  });
});
