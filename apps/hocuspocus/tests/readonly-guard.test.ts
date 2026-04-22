import { describe, it, expect, vi } from "vitest";
import { makeReadonlyGuard } from "../src/readonly-guard.js";

// Plan 2B Task 14: readonly guard unit tests.
// No DB dependency — the guard only inspects the ambient `context.readOnly`
// flag that onAuthenticate stamped onto the connection.
//
// Primary enforcement is Hocuspocus's built-in `connection.readOnly` gate
// (fed by `connectionConfig.readOnly` in onAuthenticate). This extension
// is a post-decode belt-and-suspenders check on `onChange` only — NOT on
// `beforeHandleMessage`, because that fires for reads (sync-step-1) too.

describe("readonly-guard", () => {
  it("rejects onChange when context.readOnly is true", async () => {
    const onReject = vi.fn();
    const guard = makeReadonlyGuard({ onReject });
    await expect(
      guard.onChange!({
        documentName: "page:x",
        context: { readOnly: true, userId: "u1" },
        update: new Uint8Array(),
      } as never),
    ).rejects.toThrow(/readonly/);
    expect(onReject).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledWith({
      documentName: "page:x",
      userId: "u1",
    });
  });

  it("allows onChange when context.readOnly is false", async () => {
    const onReject = vi.fn();
    const guard = makeReadonlyGuard({ onReject });
    await expect(
      guard.onChange!({
        documentName: "page:x",
        context: { readOnly: false, userId: "u" },
        update: new Uint8Array(),
      } as never),
    ).resolves.toBeUndefined();
    expect(onReject).not.toHaveBeenCalled();
  });

  it("missing/empty context is treated as writable (guard fires only on explicit readOnly=true)", async () => {
    // If onAuthenticate attached no context or a context without readOnly,
    // we should NOT throw. The onAuthenticate path is the real gate; this
    // guard only enforces the explicit readOnly=true signal.
    const guard = makeReadonlyGuard();
    await expect(
      guard.onChange!({
        documentName: "page:x",
        context: undefined,
        update: new Uint8Array(),
      } as never),
    ).resolves.toBeUndefined();
    await expect(
      guard.onChange!({
        documentName: "page:x",
        context: {},
        update: new Uint8Array(),
      } as never),
    ).resolves.toBeUndefined();
  });

  it("does NOT attach beforeHandleMessage (would kill read-only connections' sync-step-1)", () => {
    const guard = makeReadonlyGuard();
    // Explicitly absent — attaching here would throw on every incoming
    // message including read-only handshakes.
    expect(guard.beforeHandleMessage).toBeUndefined();
  });

  it("exposes priority > default so it runs before persistence", () => {
    const guard = makeReadonlyGuard();
    expect(guard.priority).toBe(200);
    expect(guard.extensionName).toBe("readonly-guard");
  });
});
