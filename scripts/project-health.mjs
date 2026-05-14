import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

const repoRoot = process.cwd();
const isCi = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
const errors = [];
const warnings = [];
const info = [];
const recommended = new Set();

function rel(path) {
  return normalize(path).replaceAll("\\", "/");
}

function pathExists(path) {
  return existsSync(join(repoRoot, path));
}

function read(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function runGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

function listGitFiles() {
  const tracked = runGit(["ls-files"]).split(/\r?\n/).filter(Boolean);
  const others = runGit(["ls-files", "--others", "--exclude-standard"])
    .split(/\r?\n/)
    .filter(Boolean);
  return [...new Set([...tracked, ...others])].map(rel);
}

function checkRequiredPaths(label, paths, { localOnly = false } = {}) {
  const missing = paths.filter((path) => !pathExists(path));
  if (missing.length === 0) {
    info.push(`${label}: OK`);
    return;
  }
  const message = `${label}: missing ${missing.join(", ")}`;
  if (localOnly || isCi) warnings.push(message);
  else errors.push(message);
}

function checkTextMarkers(path, markers) {
  if (!pathExists(path)) {
    errors.push(`${path}: missing`);
    return;
  }
  const text = read(path);
  for (const marker of markers) {
    if (!text.includes(marker)) {
      errors.push(`${path}: missing marker ${JSON.stringify(marker)}`);
    }
  }
}

function extractBacktickPathsFromFeatureRegistry() {
  if (!pathExists("docs/contributing/feature-registry.md")) return [];
  const text = read("docs/contributing/feature-registry.md");
  const paths = [];
  for (const match of text.matchAll(/`([^`]+)`/g)) {
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
    if (/^(apps|packages|docs|scripts|references|AGENTS\.md)/.test(raw)) {
      paths.push(raw);
    }
  }
  return paths;
}

function checkFeatureRegistryPaths() {
  const missing = extractBacktickPathsFromFeatureRegistry().filter((path) => !pathExists(path));
  if (missing.length > 0) {
    errors.push(
      `docs/contributing/feature-registry.md: missing owning paths: ${missing.join(", ")}`,
    );
  } else {
    info.push("feature registry owning paths: OK");
  }
}

function scanForbiddenImports(files, rules) {
  for (const file of files) {
    const text = read(file);
    for (const rule of rules) {
      if (rule.pattern.test(text)) {
        errors.push(`${file}: ${rule.message}`);
      }
    }
  }
}

function checkImportBoundaries(files) {
  const tsFiles = files.filter((file) => /\.(ts|tsx)$/.test(file));

  scanForbiddenImports(
    tsFiles.filter((file) => file.startsWith("apps/web/src/")),
    [
      {
        pattern: /from\s+["']@opencairn\/db["']|from\s+["']drizzle-orm|from\s+["']@opencairn\/api/,
        message: "apps/web must not import db, drizzle, or api packages directly",
      },
      {
        pattern: /^["']use server["'];?$/m,
        message: "apps/web must not introduce Server Actions",
      },
    ],
  );

  scanForbiddenImports(
    tsFiles.filter((file) => file.startsWith("packages/shared/src/")),
    [
      {
        pattern: /from\s+["']@opencairn\/db["']|from\s+["']@opencairn\/api|from\s+["']@opencairn\/web|from\s+["']@opencairn\/hocuspocus|from\s+["']@opencairn\/worker|from\s+["']\.\.\/\.\.\/apps\//,
        message: "packages/shared must stay app/db independent",
      },
    ],
  );

  scanForbiddenImports(
    tsFiles.filter((file) => file.startsWith("packages/db/src/")),
    [
      {
        pattern: /from\s+["']@opencairn\/(web|api|worker|hocuspocus)["']/,
        message: "packages/db must not import app packages",
      },
    ],
  );

  const workerAgentFiles = files.filter(
    (file) => file.startsWith("apps/worker/src/worker/agents/") && file.endsWith(".py"),
  );
  scanForbiddenImports(workerAgentFiles, [
    {
      pattern: /^\s*(from|import)\s+(langgraph|langchain_core|langchain)(\.|\s|$)/m,
      message: "worker agents must use the local runtime facade, not langgraph/langchain",
    },
  ]);

  if (!errors.some((message) => message.includes("must not") || message.includes("worker agents"))) {
    info.push("import boundaries: OK");
  }
}

function checkCiGateDrift() {
  if (!pathExists(".github/workflows/ci.yml") || !pathExists("docs/testing/strategy.md")) return;
  const ci = read(".github/workflows/ci.yml");
  const expected = [
    ["docs:check", /pnpm docs:check/],
    ["web i18n parity", /i18n:parity/],
    ["health harness", /check:health/],
    ["TypeScript typecheck", /tsc --noEmit|check:types/],
    ["unit tests", /vitest|test:unit|check:unit|pnpm test/],
    ["secret scan", /gitleaks|check:secrets/],
  ];
  const activeDevelopmentGates = [
    ["worker lint/type", /ruff|pyright|check:worker/],
    ["E2E", /playwright/],
  ];

  const missing = expected.filter(([, pattern]) => !pattern.test(ci)).map(([name]) => name);
  if (missing.length > 0) {
    warnings.push(
      `CI gate drift: docs/testing/strategy.md describes broader gates; ci.yml currently lacks ${missing.join(", ")}`,
    );
  } else {
    const active = activeDevelopmentGates
      .filter(([, pattern]) => !pattern.test(ci))
      .map(([name]) => name);
    if (active.length > 0) {
      info.push(`active development gates not enforced in CI yet: ${active.join(", ")}`);
    } else {
      info.push("CI gate drift: none detected");
    }
  }
}

function checkLocalContext() {
  checkRequiredPaths(
    "private maintainer docs",
    [
      ".private-docs/docs/contributing/plans-status.md",
      ".private-docs/docs/contributing/project-history.md",
      ".private-docs/docs/contributing/codex-skill-inventory.md",
    ],
    { localOnly: true },
  );
  checkRequiredPaths(
    "superpowers docs",
    ["docs/superpowers/specs", "docs/superpowers/plans"],
    { localOnly: true },
  );

  const skillsRoot = join(homedir(), ".codex", "skills");
  const expectedSkills = [
    "opencairn-commit/SKILL.md",
    "opencairn-rules/SKILL.md",
    "opencairn-post-feature/SKILL.md",
    "opencairn-next-plan/SKILL.md",
    "opencairn-parallel-sessions/SKILL.md",
  ];
  const missingSkills = expectedSkills.filter((path) => !existsSync(join(skillsRoot, path)));
  if (missingSkills.length > 0) {
    warnings.push(`local Codex skills missing or unavailable: ${missingSkills.join(", ")}`);
  } else {
    info.push("local Codex skills: OK");
  }
}

function addRecommendationsForDirtyFiles() {
  const status = runGit(["status", "--porcelain"]).split(/\r?\n/).filter(Boolean);
  const files = status.map((line) => rel(line.slice(3).trim())).filter(Boolean);
  if (files.length === 0) {
    info.push("dirty file recommendations: worktree clean");
    return;
  }

  if (files.some((file) => file.startsWith("docs/") || file === "AGENTS.md")) {
    recommended.add("pnpm docs:check");
  }
  if (
    files.some(
      (file) =>
        file === "package.json" ||
        file === "pnpm-lock.yaml" ||
        file.startsWith(".github/workflows/") ||
        file.startsWith("scripts/"),
    )
  ) {
    recommended.add("pnpm check:public");
  }
  if (files.some((file) => file.startsWith("apps/web/messages/"))) {
    recommended.add("pnpm --filter @opencairn/web i18n:parity");
  }
  if (files.some((file) => file.startsWith("apps/web/"))) {
    recommended.add("pnpm --dir apps/web exec tsc --noEmit --project tsconfig.json --pretty false");
    recommended.add("pnpm --filter @opencairn/web test");
  }
  if (files.some((file) => file.startsWith("apps/api/"))) {
    recommended.add("pnpm --filter @opencairn/api exec tsc --noEmit --project tsconfig.json");
    recommended.add("pnpm --filter @opencairn/api test");
  }
  if (files.some((file) => file.startsWith("packages/shared/"))) {
    recommended.add("pnpm --filter @opencairn/shared exec tsc --noEmit --project tsconfig.json");
    recommended.add("pnpm --filter @opencairn/shared test");
  }
  if (files.some((file) => file.startsWith("packages/db/"))) {
    recommended.add("pnpm --filter @opencairn/db exec tsc --noEmit --project tsconfig.json");
    recommended.add("pnpm --filter @opencairn/db test");
  }
  if (files.some((file) => file.startsWith("apps/worker/") || file.startsWith("packages/llm/"))) {
    recommended.add("uv run --project apps/worker check-import-boundaries");
    recommended.add("uv run --project apps/worker ruff check");
    recommended.add("uv run --project apps/worker pyright");
    recommended.add("uv run --project apps/worker pytest");
  }
  recommended.add("pnpm check:health");
  recommended.add("git diff --check");
}

function printSection(title, rows) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("- none");
    return;
  }
  for (const row of rows) console.log(`- ${row}`);
}

checkRequiredPaths("public docs router", [
  "AGENTS.md",
  "docs/README.md",
  "docs/contributing/roadmap.md",
  "docs/contributing/feature-registry.md",
  "docs/testing/strategy.md",
]);
checkRequiredPaths("architecture maps", [
  "docs/architecture/maps/README.md",
  "docs/architecture/maps/system-map.md",
  "docs/architecture/maps/feature-verification-map.md",
  "docs/architecture/maps/agentic-workflow-map.md",
  "docs/architecture/maps/maintainer-context-map.md",
  "docs/architecture/maps/testing-map.md",
]);

checkTextMarkers("AGENTS.md", [
  "Public Docs Read Order",
  "Private Maintainer Docs",
  "Contribution Rules",
  "GitHub Operations",
]);
checkTextMarkers("docs/README.md", ["contributing/feature-registry.md", "testing/strategy.md"]);
checkTextMarkers("docs/testing/strategy.md", ["Current CI", "Local Health Harness", "Target Gates"]);

const files = listGitFiles();
checkFeatureRegistryPaths();
checkImportBoundaries(files);
checkCiGateDrift();
checkLocalContext();
addRecommendationsForDirtyFiles();

console.log("OpenCairn project health");
console.log(`repo: ${repoRoot}`);
console.log(`mode: ${isCi ? "ci" : "local"}`);
printSection("OK", info);
printSection("Warnings", warnings);
printSection("Recommended verification for current changes", [...recommended]);
printSection("Errors", errors);

if (errors.length > 0) process.exit(1);
