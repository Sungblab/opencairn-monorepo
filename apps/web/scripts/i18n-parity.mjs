// Verify ko/*.json and en/*.json share identical key structure. Invoked by CI.
import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KO = resolve(__dirname, "../messages/ko");
const EN = resolve(__dirname, "../messages/en");

function collectKeys(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...collectKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

let failed = false;
const files = (await readdir(KO)).filter((f) => f.endsWith(".json"));
for (const f of files) {
  const ko = JSON.parse(await readFile(resolve(KO, f), "utf8"));
  let en;
  try {
    en = JSON.parse(await readFile(resolve(EN, f), "utf8"));
  } catch {
    console.error(`missing en/${f}`);
    failed = true;
    continue;
  }
  const koKeys = new Set(collectKeys(ko));
  const enKeys = new Set(collectKeys(en));
  const missing = [...koKeys].filter((k) => !enKeys.has(k));
  const extra = [...enKeys].filter((k) => !koKeys.has(k));
  if (missing.length || extra.length) {
    console.error(
      `${f} -- missing in en: ${missing.join(", ") || "(none)"}; extra in en: ${extra.join(", ") || "(none)"}`
    );
    failed = true;
  } else {
    console.log(`${f} parity OK (${koKeys.size} keys)`);
  }
}
process.exit(failed ? 1 : 0);
