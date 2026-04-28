// Sentry init for the Hono API.
//
// No-op when SENTRY_DSN is unset, so OSS / dev installs don't ship a phantom
// dependency on a Sentry project. When the DSN is set we initialize once,
// at boot, before any route is registered — everything imported after this
// gets the global hub automatically.
//
// Tracing + profiling are intentionally low default rates (10%) so a
// self-hosted instance under steady traffic doesn't blow through a free-tier
// quota in the first hour. Operators raise via SENTRY_TRACES_SAMPLE_RATE.

import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "production",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Defer profiler loading to operators that want it — bundling
    // @sentry/profiling-node here would make the tarball ~10 MB heavier
    // for everyone. Set SENTRY_PROFILES_SAMPLE_RATE alongside an explicit
    // dependency on @sentry/profiling-node when needed.
  });
  initialized = true;
  console.info(`[sentry] initialized (env=${process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "production"})`);
}

// Hono onError hook adapter — install with `app.onError(sentryOnError)` after
// any custom error normalization. Returns the response unchanged when Sentry
// is disabled, so wiring this in is safe regardless of DSN presence.
export function captureError(err: unknown): void {
  if (!initialized) return;
  Sentry.captureException(err);
}
