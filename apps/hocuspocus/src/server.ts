// Plan 2B Task 14: Hocuspocus server assembly entry-point.
//
// Wires config → db → permissions → auth → persistence → readonly-guard →
// block-orphan-reaper into a single runnable server:
//
//   env                 (config.ts)                 — zod-validated process.env
//   db                  (createDb)                  — own postgres pool
//   perms               (permissions-adapter.ts)    — resolveRole on note
//   verifySession       (auth.ts)                   — Better Auth cookie HMAC
//   authenticate        (auth.ts)                   — role → readOnly mapping
//   persistence         (persistence.ts)            — yjs_documents + mirror
//   readonly-guard      (readonly-guard.ts)         — drop viewer/commenter writes
//   block-orphan-reaper (block-orphan-reaper.ts)    — comments anchor cleanup
//
// The file is intentionally thin — all behaviour lives in the modules
// tested in isolation. See docs/architecture/collaboration-model.md.

import { Server } from "@hocuspocus/server";
import { createDb } from "@opencairn/db";
import { isAllowedOrigin, loadEnv } from "./config.js";
import { logger } from "./logger.js";
import { makePermissionsAdapter } from "./permissions-adapter.js";
import { makeAuthenticate, makeVerifySession } from "./auth.js";
import { makePersistence } from "./persistence.js";
import { makeReadonlyGuard } from "./readonly-guard.js";
import { makeBlockOrphanReaper } from "./block-orphan-reaper.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  const perms = makePermissionsAdapter(db);
  const verifySession = makeVerifySession({
    db,
    secret: env.BETTER_AUTH_SECRET,
  });
  const authenticate = makeAuthenticate({
    resolveRole: perms.resolveRole,
    verifySession,
  });
  const persistence = makePersistence({ db });

  const server = new Server({
    port: env.HOCUSPOCUS_PORT,
    name: "opencairn-hocuspocus",
    async onUpgrade({ request }) {
      const origin = request.headers.origin;
      if (!isAllowedOrigin(origin, env.HOCUSPOCUS_ORIGINS)) {
        logger.warn({ origin }, "blocked hocuspocus origin");
        throw new Error("Forbidden origin");
      }
    },
    async onAuthenticate(payload) {
      // Our `authenticate` resolves the caller's role on the note and returns
      // an AuthContext (userId, userName, readOnly). Returning it attaches
      // those fields to `connection.context` for downstream hooks.
      //
      // CRITICAL: we must ALSO mutate `payload.connectionConfig.readOnly` —
      // that flag is what Hocuspocus's internal MessageReceiver checks to
      // silently-ack (not apply) sync-step-2 / update messages. Context-only
      // readOnly does not activate the internal gate.
      //
      // S1-002 — pass the WS upgrade Cookie header so `authenticate` can fall
      // back to the Better Auth session cookie when the client's `token`
      // field is empty (httpOnly cookies aren't readable from JS, so the
      // browser provider can't put the session into `token` directly).
      const ctx = await authenticate({
        documentName: payload.documentName,
        token: payload.token,
        cookieHeader: payload.requestHeaders.cookie,
      });
      payload.connectionConfig.readOnly = ctx.readOnly;
      return ctx;
    },
    extensions: [
      // priority 200: must fire before persistence on both
      // beforeHandleMessage + onChange.
      makeReadonlyGuard(),
      // default priority (100): observer only, idempotent, safe to run
      // after persistence has committed the Y-state.
      makeBlockOrphanReaper(db),
      persistence.extension(),
    ],
    async onDisconnect({ documentName, context }) {
      const ctx = context as { userId?: string } | undefined;
      logger.info(
        { userId: ctx?.userId, documentName },
        "ws disconnect",
      );
    },
  });

  await server.listen();
  logger.info(
    { port: env.HOCUSPOCUS_PORT },
    "hocuspocus listening",
  );
}

main().catch((err) => {
  logger.error({ err }, "fatal");
  process.exit(1);
});
