import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { readFileSync } from "fs";
import { join } from "path";

// Next.js reads .env only from its own app directory, not the monorepo root.
// Load the root .env manually so NEXT_PUBLIC_* vars are available at build time.
try {
  const raw = readFileSync(join(process.cwd(), "../../.env"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  // Root .env not present — vars must be injected externally (CI, Docker, etc.)
}

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

const nextConfig: NextConfig = {
  output: "standalone",
};

export default withNextIntl(nextConfig);
