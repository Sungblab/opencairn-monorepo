// Plan 2B Task 14: readonly guard.
//
// Belt-and-suspenders enforcement of the read-only contract on top of
// Hocuspocus's built-in `connection.readOnly` handling.
//
// Hocuspocus natively silently-acks sync-step-2 / update messages from
// connections with `readOnly = true` (see
// @hocuspocus/server MessageReceiver.ts — the handler responds with
// `writeSyncStatus(false)` and never applies the update). So the primary
// enforcement is simply ensuring `connectionConfig.readOnly` gets set by
// onAuthenticate when the resolved role is viewer/commenter.
//
// This extension adds a second check: if a writer update ever managed to
// slip past the internal gate (say, a future protocol message, or an
// extension that called `document.transact` on behalf of a readonly
// context), `onChange` still throws and prevents `onStoreDocument`. We
// attach the check to `onChange` only — NOT `beforeHandleMessage`:
// `beforeHandleMessage` fires for *every* incoming message including
// sync-step-1 (read-only handshake), so throwing there would hard-close
// readonly connections entirely, defeating the read path.
//
// See docs/architecture/collaboration-model.md § readonly enforcement.

import type { Extension, onChangePayload } from "@hocuspocus/server";
import { logger } from "./logger.js";

export interface ReadonlyGuardOptions {
  /**
   * Test/observability hook. Fires whenever a write attempt is rejected
   * — used by tests to assert the guard ran, and by metrics wiring to
   * count rejection rates by user/document.
   */
  onReject?: (payload: {
    documentName: string;
    userId?: string;
  }) => void;
}

interface ReadonlyContext {
  readOnly?: boolean;
  userId?: string;
}

export function makeReadonlyGuard(
  opts: ReadonlyGuardOptions = {},
): Extension {
  return {
    extensionName: "readonly-guard",
    // Higher priority runs first; we want this before persistence so a
    // rejected message never reaches the Database extension's onChange.
    priority: 200,

    async onChange(payload: onChangePayload) {
      const ctx = payload.context as ReadonlyContext | undefined;
      if (!ctx?.readOnly) return;
      opts.onReject?.({
        documentName: payload.documentName,
        userId: ctx.userId,
      });
      logger.warn(
        { userId: ctx.userId, doc: payload.documentName },
        "readonly: change rejected (post-decode fallback — Hocuspocus internal gate leaked)",
      );
      throw new Error("readonly");
    },
  };
}
