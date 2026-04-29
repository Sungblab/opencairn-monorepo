import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const messagesDir = new URL("../messages/", import.meta.url);
const locale = "en";
const koreanPattern = /[가-힣]/;

function flatten(value, prefix = "", out = []) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  if (typeof value === "string") out.push([prefix, value]);
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out));
  }
  return out;
}

const failures = [];
const files = (await readdir(new URL(`${locale}/`, messagesDir)))
  .filter((file) => file.endsWith(".json"))
  .sort();

for (const file of files) {
  const fullPath = new URL(`${locale}/${file}`, messagesDir);
  const json = JSON.parse(await readFile(fullPath, "utf8"));
  for (const [key, value] of flatten(json)) {
    if (koreanPattern.test(value)) {
      failures.push(`${file}:${key} still contains Korean copy`);
    }
  }
}

if (failures.length) {
  console.error(`i18n quality failed for ${path.join("messages", locale)}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`i18n quality OK (${locale}, ${files.length} files)`);
