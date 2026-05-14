import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const errors = [];

const skipPath = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|\.turbo|docs\/superpowers|\.private-docs)\//;
const skipFile = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|br|wasm|ttf|woff|woff2|lock)$/i;
const allowText =
  /(example|placeholder|changeme|your_|test[_-]|dummy|fake|mock|sample|localhost|opencairn_test)/i;

const patterns = [
  ["private key block", /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["OpenAI API key", /\bsk-[A-Za-z0-9_-]{32,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  [
    "generic assigned secret",
    /\b(?:SECRET|TOKEN|API_KEY|PRIVATE_KEY|PASSWORD)\b\s*[:=]\s*["'][A-Za-z0-9+/=_-]{24,}["']/i,
  ],
];

function gitFiles() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));
}

for (const file of gitFiles()) {
  if (skipPath.test(`${file}/`) || skipFile.test(file)) continue;

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (allowText.test(line)) continue;
    for (const [label, pattern] of patterns) {
      if (pattern.test(line)) {
        errors.push(`${file}:${index + 1}: ${label}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Secret scan failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Secret scan passed.");
