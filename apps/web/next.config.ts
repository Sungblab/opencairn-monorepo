import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { readFileSync } from "fs";
import { join } from "path";

const MONOREPO_ROOT = join(process.cwd(), "../..");

// Next.js reads .env only from its own app directory, not the monorepo root.
// Load the root .env manually so NEXT_PUBLIC_* vars are available at build time.
try {
  const raw = readFileSync(join(MONOREPO_ROOT, ".env"), "utf8");
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
// - connect-src keeps jsDelivr open because EmbedPDF/PDFium fetches optional
//   CJK/Latin font fallback packages from the same CDN when a PDF lacks fonts.
// - frame-src 'self' blob: + worker-src 'self' blob: cover the iframe Blob URL
//   pattern used by CanvasFrame and any future Pyodide Web Worker.
// - 'unsafe-inline' on style-src is preserved for Tailwind's runtime
//   classes; tightening to nonces is a Phase 2+ exercise.
// - 'unsafe-inline' on script-src: kept for BOTH dev and production. Next.js
//   App Router streams hydration data via inline `<script>self.__next_f.push(...)`
//   on every SSR'd page. Without a nonce, that traffic is blocked outright;
//   an earlier dev-only gate broke prod silently because nobody noticed
//   hydration regressing. Tightening requires a per-request nonce middleware
//   (Edge runtime — `next.config.ts` static headers cannot generate one) —
//   tracked as Phase 2+ alongside the style-src nonce migration. Until then,
//   both directives accept inline.
const CSP_HEADER = [
  "default-src 'self'",
  "frame-src 'self' blob:",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net/pyodide/ https://esm.sh",
  "worker-src 'self' blob:",
  "connect-src 'self' https://esm.sh https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: MONOREPO_ROOT,
  },
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
