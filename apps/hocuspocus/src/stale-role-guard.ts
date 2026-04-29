// 2026-04-29 frontend-security-audit Finding 6 — periodic role + session-
// expiry re-check on the live WS connection.
//
// onAuthenticate decides `readOnly` and the user's session expiry exactly once
// at connect time, then stamps the result onto `connection.context` and
// `connection.readOnly`. Without this guard, three things go stale:
//
//   1. Admin demotes the user from editor → viewer (or removes them) via the
//      HTTP API. Existing HTTP routes start rejecting, but the persistent WS
//      keeps editor privileges until the user closes the tab. Edits keep
//      flowing through Yjs into `notes.content`.
//   2. Per-note grant gets revoked. Same problem, finer scope.
//   3. The Better Auth session expires (TTL hits, password changed, manual
//      revocation). The HTTP layer rejects on next request; the WS does not.
//
// This extension hooks `beforeHandleMessage` (fires on every incoming WS
// message) and:
//
//   - Closes the connection if `Date.now() >= context.sessionExpiresAt`
//     (no DB hit — value was cached at connect time).
//   - Re-resolves the user's role on the note with a TTL cache (default 30s).
//     - role === "none"   → close connection (full revoke).
//     - role downgraded to viewer/commenter → mutate `connection.readOnly`
//       and `context.readOnly` so Hocuspocus's internal write gate AND the
//       readonly-guard extension both kick in for subsequent messages.
//     - role unchanged or upgraded → no-op.
//
// We deliberately do NOT throw on downgrade — readonly users still need
// sync-step-1 (read handshake) to succeed. The readOnly mutation is enough:
// Hocuspocus's MessageReceiver silently-acks sync-step-2 / update messages
// from readonly connections, and readonly-guard rejects on `onChange` as a
// belt-and-suspenders fallback.
//
// On full revoke we call `connection.close()` to send a clean WebSocket close
// frame instead of throwing, so we don't trip @hocuspocus/server's "rethrow
// any truthy hook rejection on the EventEmitter listener" behavior the way
// the old onUpgrade hook did (S1-003).

import type { Extension, beforeHandleMessagePayload } from "@hocuspocus/server";
import type { PermissionsAdapter } from "./permissions-adapter.js";
import { logger } from "./logger.js";

export const DEFAULT_ROLE_CACHE_TTL_MS = 30_000;

const DOC_RE =
  /^page:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

interface CachedRole {
  role: Awaited<ReturnType<PermissionsAdapter["resolveRole"]>>;
  expiresAt: number;
}

interface StaleRoleContext {
  userId?: string;
  readOnly?: boolean;
  sessionExpiresAt?: number;
}

export interface StaleRoleGuardOptions {
  resolveRole: PermissionsAdapter["resolveRole"];
  /** TTL for the per-(userId, noteId) role cache. Default 30s. */
  ttlMs?: number;
  /** Time source — overridable for tests. Default `Date.now`. */
  now?: () => number;
  /**
   * Test/observability hook. Fires when a connection is closed because the
   * user's role dropped to `none` or their session expired.
   */
  onRevoke?: (info: {
    documentName: string;
    userId: string;
    reason: "session_expired" | "role_revoked";
  }) => void;
  /**
   * Test/observability hook. Fires when a connection's readonly flag flips
   * true because the user's role downgraded.
   */
  onDowngrade?: (info: {
    documentName: string;
    userId: string;
    fromReadOnly: boolean;
  }) => void;
}

export function makeStaleRoleGuard(opts: StaleRoleGuardOptions): Extension {
  const ttlMs = opts.ttlMs ?? DEFAULT_ROLE_CACHE_TTL_MS;
  const now = opts.now ?? Date.now;
  // Per-extension-instance cache. Keyed by `${userId}:${noteId}`. Bounded by
  // the number of distinct (user, note) pairs across active connections — no
  // explicit eviction needed because entries naturally rot out via the TTL.
  const cache = new Map<string, CachedRole>();

  async function getRole(
    userId: string,
    noteId: string,
  ): Promise<CachedRole["role"]> {
    const key = `${userId}:${noteId}`;
    const cached = cache.get(key);
    const t = now();
    if (cached && cached.expiresAt > t) return cached.role;
    const role = await opts.resolveRole(userId, { type: "note", id: noteId });
    cache.set(key, { role, expiresAt: t + ttlMs });
    return role;
  }

  return {
    extensionName: "stale-role-guard",
    // Higher than readonly-guard (200) so a downgrade-induced readOnly mutation
    // is visible by the time readonly-guard's onChange runs.
    priority: 250,

    async beforeHandleMessage(payload: beforeHandleMessagePayload) {
      const ctx = payload.context as StaleRoleContext | undefined;
      const userId = ctx?.userId;
      if (!userId) return;
      const m = DOC_RE.exec(payload.documentName);
      if (!m) return;
      const noteId = m[1]!;

      // 1. Session expiry — no DB hit; expiresAt was stamped at connect time.
      if (
        typeof ctx.sessionExpiresAt === "number" &&
        now() >= ctx.sessionExpiresAt
      ) {
        logger.warn(
          { userId, doc: payload.documentName },
          "stale-role-guard: session expired, closing ws",
        );
        opts.onRevoke?.({
          documentName: payload.documentName,
          userId,
          reason: "session_expired",
        });
        payload.connection.readOnly = true;
        payload.context.readOnly = true;
        payload.connection.close();
        return;
      }

      // 2. Role re-check (TTL-cached).
      const role = await getRole(userId, noteId);
      if (role === "none") {
        logger.warn(
          { userId, doc: payload.documentName },
          "stale-role-guard: role revoked, closing ws",
        );
        opts.onRevoke?.({
          documentName: payload.documentName,
          userId,
          reason: "role_revoked",
        });
        payload.connection.readOnly = true;
        payload.context.readOnly = true;
        payload.connection.close();
        return;
      }

      const shouldBeReadOnly = role === "viewer" || role === "commenter";
      if (shouldBeReadOnly && !ctx.readOnly) {
        logger.warn(
          { userId, doc: payload.documentName, role },
          "stale-role-guard: role downgraded to readonly mid-session",
        );
        opts.onDowngrade?.({
          documentName: payload.documentName,
          userId,
          fromReadOnly: false,
        });
        payload.connection.readOnly = true;
        payload.context.readOnly = true;
      }
      // role === "editor" / "admin" / "owner" → no-op; if user was previously
      // downgraded and got re-promoted, the readOnly flag stays true until
      // they reconnect, which is conservative-safe.
    },
  };
}
