// ko/*.json → en/*.json raw copy stopgap. Run after ko edits until real en translation pass.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KO = resolve(__dirname, "../messages/ko");
const EN = resolve(__dirname, "../messages/en");

const files = await readdir(KO);
let count = 0;
for (const f of files) {
  if (!f.endsWith(".json")) continue;
  const content = await readFile(resolve(KO, f), "utf8");
  await mkdir(EN, { recursive: true });
  await writeFile(resolve(EN, f), content);
  console.log(`synced ${f}`);
  count++;
}
console.log(`synced ${count} files from ko -> en`);
