import { chromium } from "playwright";
import { existsSync } from "node:fs";
import type { SynthesisOutputJson } from "./docx";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] ?? c));
}

function buildHtml(out: SynthesisOutputJson): string {
  // Section content is trusted per ResearchAgent prompt contract (a small
  // HTML subset). page.route blocks all network as defense-in-depth.
  const sections = out.sections
    .map((s) => `<section><h2>${escapeHtml(s.title)}</h2>${s.content}</section>`)
    .join("\n");

  const bibliography = out.bibliography.length > 0
    ? `<section><h2>References</h2><ol>${out.bibliography
        .map((b) => `<li>${escapeHtml(b.author)}, <em>${escapeHtml(b.title)}</em>${b.year ? `, ${b.year}` : ""}${b.url ? `, <a href="${escapeHtml(b.url)}">${escapeHtml(b.url)}</a>` : ""}</li>`)
        .join("")}</ol></section>`
    : "";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(out.title)}</title>
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 28px; margin-bottom: 0.4em; }
  h2 { font-size: 20px; margin-top: 1.6em; }
  p { margin: 0.6em 0; }
  ol li { margin: 0.3em 0; }
  .abstract { font-style: italic; border-left: 3px solid #ddd; padding-left: 1em; margin: 1em 0; }
</style>
</head>
<body>
<h1>${escapeHtml(out.title)}</h1>
${out.abstract ? `<div class="abstract">${escapeHtml(out.abstract)}</div>` : ""}
${sections}
${bibliography}
</body>
</html>`;
}

function chromiumLaunchArgs(): string[] {
  const noSandbox =
    process.env.PLAYWRIGHT_NO_SANDBOX === "1" ||
    process.env.NODE_ENV === "production";
  return noSandbox ? ["--no-sandbox"] : [];
}

function chromiumExecutablePath(): string | undefined {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter((path): path is string => Boolean(path));
  return candidates.find((path) => existsSync(path));
}

export async function compilePdf(out: SynthesisOutputJson): Promise<Buffer> {
  // TODO(perf): browser-per-call is fine for v1; consider a module-level
  // singleton + mutex if synthesis throughput becomes a bottleneck.
  const executablePath = chromiumExecutablePath();
  const browser = await chromium.launch({
    args: chromiumLaunchArgs(),
    ...(executablePath ? { executablePath } : {}),
  });
  let ctx;
  try {
    ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Defense-in-depth: HTML is fully self-contained (inline CSS).
    // Block all network so a stray <img>/<script src> can't exfiltrate.
    await page.route("**", (route) => route.abort());
    await page.setContent(buildHtml(out), { waitUntil: "domcontentloaded" });
    const buf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "2cm", right: "2cm", bottom: "2cm", left: "2cm" },
    });
    return buf;
  } finally {
    if (ctx) await ctx.close();
    await browser.close();
  }
}
