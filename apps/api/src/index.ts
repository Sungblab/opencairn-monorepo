import { serve } from "@hono/node-server";
import { initSentry } from "./lib/sentry";
// Initialize Sentry BEFORE createApp() so any module-load-time exceptions in
// downstream imports get captured. No-op when SENTRY_DSN is unset.
initSentry();

import { createApp } from "./app";
import { ensureBucket } from "./lib/s3";

const app = createApp();
const port = Number(process.env.PORT) || 4000;

// Best-effort bucket provisioning at startup. MinIO/R2 is required for
// Plan 3 ingest, but we don't want to crash the API if storage is briefly
// unreachable on boot — the upload endpoint will surface the error instead.
ensureBucket().catch((err) => {
  console.warn(`[API] ensureBucket failed (storage unreachable?): ${String(err)}`);
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[API] Server running on http://localhost:${info.port}`);
});
