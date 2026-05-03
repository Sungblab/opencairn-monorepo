import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const repoRoot = process.cwd();
const errors = [];

function read(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function exists(path) {
  return existsSync(join(repoRoot, path));
}

function report(source, target, reason) {
  errors.push(`${source}: ${target} (${reason})`);
}

function normalizeDocTarget(source, target) {
  let clean = target.trim();
  clean = clean.split("#")[0];
  if (!clean || clean.startsWith("http://") || clean.startsWith("https://")) {
    return null;
  }
  if (clean.endsWith("/")) {
    return clean;
  }
  const sourceDir = dirname(source);
  return normalize(join(sourceDir, clean)).replaceAll("\\", "/");
}

function checkMarkdownLinks(source) {
  const text = read(source);
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of text.matchAll(linkPattern)) {
    const target = normalizeDocTarget(source, match[1]);
    if (!target) continue;
    if (!exists(target)) report(source, target, "missing markdown link target");
  }
}

function checkDocsIndexCodePaths(source) {
  const text = read(source);
  const codePathPattern = /`([^`]+)`/g;
  for (const match of text.matchAll(codePathPattern)) {
    const raw = match[1].trim();
    if (!raw || raw.includes("*") || raw.includes("<") || raw.includes(">")) {
      continue;
    }
    if (!raw.includes("/") || (!raw.endsWith(".md") && !raw.endsWith("/"))) {
      continue;
    }

    const candidates = [];
    if (source === "docs/README.md") {
      candidates.push(normalize(join("docs", raw)).replaceAll("\\", "/"));
    }
    candidates.push(normalize(raw).replaceAll("\\", "/"));

    if (!candidates.some((candidate) => exists(candidate))) {
      report(source, raw, "missing indexed doc path");
    }
  }
}

function checkPlanStatusPlanFiles() {
  const source = "docs/contributing/plans-status.md";
  const text = read(source);
  const planPattern = /`(20\d{2}-\d{2}-\d{2}[^`]+\.md)`/g;
  for (const match of text.matchAll(planPattern)) {
    const filename = match[1];
    if (filename.includes("*")) continue;
    const candidates = [
      `docs/superpowers/plans/${filename}`,
      `docs/superpowers/specs/${filename}`,
    ];
    if (!candidates.some((candidate) => exists(candidate))) {
      report(source, filename, "missing plan/spec file referenced by status");
    }
  }
}

function checkFeatureRegistryPaths() {
  const source = "docs/contributing/feature-registry.md";
  const text = read(source);
  const codePathPattern = /`([^`]+)`/g;
  for (const match of text.matchAll(codePathPattern)) {
    const raw = match[1].trim();
    if (
      !raw ||
      raw.includes("*") ||
      raw.includes("<") ||
      raw.includes(">") ||
      raw.includes("{") ||
      raw.includes("}")
    ) {
      continue;
    }
    if (!/^(apps|packages|docs|scripts|references|AGENTS\.md|CLAUDE\.md)/.test(raw)) {
      continue;
    }
    if (!exists(raw)) report(source, raw, "missing feature registry path");
  }
}

for (const source of [
  "docs/README.md",
  "docs/contributing/project-history.md",
  "docs/contributing/feature-registry.md",
]) {
  checkMarkdownLinks(source);
  checkDocsIndexCodePaths(source);
}

checkPlanStatusPlanFiles();
checkFeatureRegistryPaths();

if (errors.length > 0) {
  console.error("Docs consistency check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Docs consistency check passed.");
