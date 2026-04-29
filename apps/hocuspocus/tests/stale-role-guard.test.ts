import { describe, it, expect, vi } from "vitest";
import {
  makeStaleRoleGuard,
  DEFAULT_ROLE_CACHE_TTL_MS,
} from "../src/stale-role-guard.js";

// Plan 2B follow-up — 2026-04-29 frontend-security-audit Finding 6.
//
// onAuthenticate decides readOnly + sessionExpiresAt once at connect time.
// Without re-checking, an admin demoting a user from editor → viewer (or
// removing them entirely), or a Better Auth session expiring, leaves the
// open WS connection with stale editor privileges. The stale-role-guard
// extension's beforeHandleMessage hook re-runs both checks per message,
// using a TTL cache so the role re-resolution doesn't pound the DB.

const NOTE_ID = "11111111-2222-3333-4444-555555555555";
const DOC = `page:${NOTE_ID}`;
const USER_ID = "user-1";

function payload(
  overrides: Partial<{
    documentName: string;
    context: Record<string, unknown> | undefined;
    readOnly: boolean;
    close: () => void;
  }> = {},
) {
  const closeSpy = overrides.close ?? vi.fn();
  const connection = {
    readOnly: overrides.readOnly ?? false,
    close: closeSpy,
  };
  const ctx = overrides.context ?? {
    userId: USER_ID,
    readOnly: false,
    sessionExpiresAt: Date.now() + 60_000,
  };
  return {
    documentName: overrides.documentName ?? DOC,
    context: ctx,
    connection,
    closeSpy,
  };
}

describe("stale-role-guard", () => {
  it("priority 250 (must run before readonly-guard at 200)", () => {
    const ext = makeStaleRoleGuard({ resolveRole: vi.fn() });
    expect(ext.priority).toBe(250);
    expect(ext.extensionName).toBe("stale-role-guard");
  });

  it("editor → no-op (no DB hit on cache hit, role unchanged)", async () => {
    const resolveRole = vi.fn().mockResolvedValue("editor");
    const ext = makeStaleRoleGuard({ resolveRole });
    const p = payload();
    await ext.beforeHandleMessage!(p as never);
    expect(p.connection.readOnly).toBe(false);
    expect(p.context.readOnly).toBe(false);
    expect(p.closeSpy).not.toHaveBeenCalled();
    expect(resolveRole).toHaveBeenCalledOnce();
  });

  it("role downgraded editor → viewer flips connection.readOnly + context.readOnly to true", async () => {
    const resolveRole = vi.fn().mockResolvedValue("viewer");
    const onDowngrade = vi.fn();
    const ext = makeStaleRoleGuard({ resolveRole, onDowngrade });
    const p = payload();
    await ext.beforeHandleMessage!(p as never);
    expect(p.connection.readOnly).toBe(true);
    expect(p.context.readOnly).toBe(true);
    expect(p.closeSpy).not.toHaveBeenCalled();
    expect(onDowngrade).toHaveBeenCalledWith({
      documentName: DOC,
      userId: USER_ID,
      fromReadOnly: false,
    });
  });

  it("role downgraded editor → commenter also flips readonly", async () => {
    const resolveRole = vi.fn().mockResolvedValue("commenter");
    const ext = makeStaleRoleGuard({ resolveRole });
    const p = payload();
    await ext.beforeHandleMessage!(p as never);
    expect(p.connection.readOnly).toBe(true);
    expect(p.context.readOnly).toBe(true);
  });

  it("role revoked (none) → closes connection + sets readonly", async () => {
    const resolveRole = vi.fn().mockResolvedValue("none");
    const onRevoke = vi.fn();
    const ext = makeStaleRoleGuard({ resolveRole, onRevoke });
    const p = payload();
    await ext.beforeHandleMessage!(p as never);
    expect(p.connection.readOnly).toBe(true);
    expect(p.context.readOnly).toBe(true);
    expect(p.closeSpy).toHaveBeenCalledOnce();
    expect(onRevoke).toHaveBeenCalledWith({
      documentName: DOC,
      userId: USER_ID,
      reason: "role_revoked",
    });
  });

  it("session expired → closes connection without hitting resolveRole", async () => {
    const resolveRole = vi.fn();
    const onRevoke = vi.fn();
    const ext = makeStaleRoleGuard({ resolveRole, onRevoke });
    const p = payload({
      context: {
        userId: USER_ID,
        readOnly: false,
        sessionExpiresAt: Date.now() - 1, // already expired
      },
    });
    await ext.beforeHandleMessage!(p as never);
    expect(p.closeSpy).toHaveBeenCalledOnce();
    expect(p.connection.readOnly).toBe(true);
    expect(resolveRole).not.toHaveBeenCalled();
    expect(onRevoke).toHaveBeenCalledWith({
      documentName: DOC,
      userId: USER_ID,
      reason: "session_expired",
    });
  });

  it("missing context.userId → no-op (auth never ran)", async () => {
    const resolveRole = vi.fn();
    const ext = makeStaleRoleGuard({ resolveRole });
    // Pass an empty-but-defined context — the guard's `!userId` check should
    // short-circuit before any role resolution. Using `undefined` would
    // trigger the helper's default fallback ctx.
    const p = payload({ context: {} });
    await ext.beforeHandleMessage!(p as never);
    expect(resolveRole).not.toHaveBeenCalled();
    expect(p.closeSpy).not.toHaveBeenCalled();
  });

  it("non-page document name → no-op (workspace:* etc.)", async () => {
    const resolveRole = vi.fn();
    const ext = makeStaleRoleGuard({ resolveRole });
    const p = payload({ documentName: "workspace:foo" });
    await ext.beforeHandleMessage!(p as never);
    expect(resolveRole).not.toHaveBeenCalled();
  });

  it("TTL cache: same (user, note) within ttlMs → resolveRole called once", async () => {
    let t = 1_000_000;
    const resolveRole = vi.fn().mockResolvedValue("editor");
    const ext = makeStaleRoleGuard({
      resolveRole,
      ttlMs: 30_000,
      now: () => t,
    });
    const p1 = payload();
    await ext.beforeHandleMessage!(p1 as never);
    t += 10_000;
    const p2 = payload();
    await ext.beforeHandleMessage!(p2 as never);
    t += 10_000;
    const p3 = payload();
    await ext.beforeHandleMessage!(p3 as never);
    expect(resolveRole).toHaveBeenCalledTimes(1);
  });

  it("TTL cache: re-resolves after ttlMs and surfaces fresh role", async () => {
    let t = 1_000_000;
    const resolveRole = vi
      .fn()
      .mockResolvedValueOnce("editor")
      .mockResolvedValueOnce("none");
    const ext = makeStaleRoleGuard({
      resolveRole,
      ttlMs: 30_000,
      now: () => t,
    });

    const p1 = payload();
    await ext.beforeHandleMessage!(p1 as never);
    expect(p1.closeSpy).not.toHaveBeenCalled();

    t += 30_001; // bust cache
    const p2 = payload();
    await ext.beforeHandleMessage!(p2 as never);
    expect(p2.closeSpy).toHaveBeenCalledOnce();
    expect(resolveRole).toHaveBeenCalledTimes(2);
  });

  it("DEFAULT_ROLE_CACHE_TTL_MS exported as 30s", () => {
    expect(DEFAULT_ROLE_CACHE_TTL_MS).toBe(30_000);
  });
});
