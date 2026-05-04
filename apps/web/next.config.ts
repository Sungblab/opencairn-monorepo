import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { readFileSync, realpathSync } from "fs";
import { createRequire } from "module";
import { join } from "path";

const require = createRequire(import.meta.url);
const MONOREPO_ROOT = join(process.cwd(), "../..");
const YJS_SINGLETON_MODULE = realpathSync(require.resolve("yjs"));

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
  // Plan 2E Phase B — add embed provider origins so iframes load in production.
  // Dev (`next dev`) doesn't enforce CSP; without these the iframes are blocked
  // in production by the default-src 'self' fallback.
  "frame-src 'self' blob: https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net/pyodide/ https://esm.sh",
  "worker-src 'self' blob:",
  "connect-src 'self' https://esm.sh https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@hocuspocus/provider",
    "@platejs/yjs",
    "@slate-yjs/core",
    "y-protocols",
  ],
  turbopack: {
    root: MONOREPO_ROOT,
  },
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals ??= [];
      config.externals.push({ yjs: "commonjs yjs" });
    }
    config.resolve ??= {};
    if (!isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        // Yjs warns when both its ESM and CJS bundles are evaluated in the same
        // browser realm. Plate/Yjs and Hocuspocus have mixed import styles, so
        // pin the bare package import to one browser module.
        yjs: YJS_SINGLETON_MODULE,
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: CSP_HEADER }],
      },
    ];
  },
  // 2026-04-30 URL restructure. Sunset 2026-05-14.
  async redirects() {
    return [
      {
        source: "/:locale/app/w/:slug/p/:pid/notes/:nid",
        destination: "/:locale/workspace/:slug/project/:pid/note/:nid",
        permanent: false,
      },
      {
        source: "/:locale/app/w/:slug/p/:pid/:rest*",
        destination: "/:locale/workspace/:slug/project/:pid/:rest*",
        permanent: false,
      },
      {
        source: "/:locale/app/w/:slug/n/:nid",
        destination: "/:locale/workspace/:slug/note/:nid",
        permanent: false,
      },
      {
        source: "/:locale/app/w/:slug/:rest*",
        destination: "/:locale/workspace/:slug/:rest*",
        permanent: false,
      },
      {
        source: "/:locale/app/w/:slug",
        destination: "/:locale/workspace/:slug",
        permanent: false,
      },
      {
        source: "/:locale/app/dashboard",
        destination: "/:locale/dashboard",
        permanent: false,
      },
      {
        source: "/:locale/app/settings/:rest*",
        destination: "/:locale/settings/:rest*",
        permanent: false,
      },
      {
        source: "/:locale/app",
        destination: "/:locale/dashboard",
        permanent: false,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
