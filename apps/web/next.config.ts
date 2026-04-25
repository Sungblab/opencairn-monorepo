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

// CSP allowlist supporting Plan 7 canvas runtime:
// - 'unsafe-eval' is required by Pyodide's WASM compilation path (ADR-006).
// - script-src + connect-src allow Pyodide + esm.sh CDN loads.
// - frame-src 'self' blob: + worker-src 'self' blob: cover the iframe Blob URL
//   pattern used by CanvasFrame and any future Pyodide Web Worker.
// - 'unsafe-inline' on style-src is preserved for Tailwind's runtime
//   classes; tightening to nonces is a Phase 2+ exercise.
// - Dev mode: Next.js / Turbopack injects inline bootstrap <script> tags
//   (self.__next_r etc.) without a nonce, so 'unsafe-inline' is required
//   for hydration. Production keeps the strict policy.
const isDev = process.env.NODE_ENV !== "production";
const CSP_HEADER = [
  "default-src 'self'",
  "frame-src 'self' blob:",
  `script-src 'self' 'unsafe-eval'${isDev ? " 'unsafe-inline'" : ""} https://cdn.jsdelivr.net/pyodide/ https://esm.sh`,
  "worker-src 'self' blob:",
  "connect-src 'self' https://esm.sh https://cdn.jsdelivr.net/pyodide/",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: CSP_HEADER }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
