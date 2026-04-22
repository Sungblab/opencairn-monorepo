import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Server } from "@hocuspocus/server";
import { createDb } from "@opencairn/db";
import { makePermissionsAdapter } from "../src/permissions-adapter.js";
import { makeAuthenticate, makeVerifySession } from "../src/auth.js";
import { makePersistence } from "../src/persistence.js";
import { makeReadonlyGuard } from "../src/readonly-guard.js";
import { PLATE_BRIDGE_ROOT_KEY } from "../src/plate-bridge.js";
import {
  seedMultiRoleWorkspace,
  type SeedMultiRoleResult,
} from "../../api/tests/helpers/seed.js";
import { signSessionForUser } from "../../api/src/lib/test-session.js";

// Plan 2B Task 14: 2-client WS round-trip smoke test.
//
// Boots a real Hocuspocus server on an ephemeral port with the full
// extension stack assembled. Then connects two HocuspocusProvider clients
// (editor + commenter), lets the editor write, and asserts the commenter
// sees the edit — proving both (a) onAuthenticate + persistence wired up,
// and (b) readonly-guard allows reads while blocking writes.
//
// Uses Node 22's built-in global WebSocket — no `ws` polyfill needed.
// `stopOnSignals: false` so the server doesn't register signal handlers
// during tests (leaks across files otherwise).

async function startTestServer(): Promise<{
  server: Server;
  port: number;
  address: string;
}> {
  const db = createDb(process.env.DATABASE_URL!);
  const perms = makePermissionsAdapter(db);
  const verifySession = makeVerifySession({
    db,
    secret: process.env.BETTER_AUTH_SECRET!,
  });
  const authenticate = makeAuthenticate({
    resolveRole: perms.resolveRole,
    verifySession,
  });
  const persistence = makePersistence({ db });

  // Port 0 → OS picks a free port. We read it back from server.address.
  const server = new Server({
    port: 0,
    address: "127.0.0.1",
    stopOnSignals: false,
    quiet: true,
    name: "hocuspocus-smoke",
    async onAuthenticate(payload) {
      const ctx = await authenticate({
        documentName: payload.documentName,
        token: payload.token,
      });
      // Mirror server.ts: activate Hocuspocus's internal readOnly gate.
      payload.connectionConfig.readOnly = ctx.readOnly;
      return ctx;
    },
    extensions: [
      makeReadonlyGuard(),
      persistence.extension(),
    ],
  });

  await server.listen();
  const { port, address } = server.address;
  return { server, port, address };
}

async function waitForSync(
  provider: HocuspocusProvider,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    provider.on("synced", finish);
    setTimeout(finish, timeoutMs);
  });
}

describe("ws smoke", () => {
  it(
    "editor write propagates to commenter client",
    async () => {
      let seed: SeedMultiRoleResult | null = null;
      let harness: Awaited<ReturnType<typeof startTestServer>> | null = null;
      const providers: HocuspocusProvider[] = [];
      try {
        seed = await seedMultiRoleWorkspace();
        harness = await startTestServer();

        const url = `ws://127.0.0.1:${harness.port}`;
        const docName = `page:${seed.noteId}`;

        const mkClient = async (
          userId: string,
        ): Promise<{ doc: Y.Doc; provider: HocuspocusProvider }> => {
          const { cookieHeader } = await signSessionForUser(userId);
          const doc = new Y.Doc();
          const provider = new HocuspocusProvider({
            url,
            name: docName,
            document: doc,
            token: cookieHeader,
            // Node 22 has a global WebSocket; HocuspocusProvider picks it up.
          });
          providers.push(provider);
          await waitForSync(provider);
          return { doc, provider };
        };

        const editor = await mkClient(seed.editorUserId);
        const commenter = await mkClient(seed.commenterUserId);

        // Editor writes to the shared XmlText — same root key used by the
        // Plate <-> Y.Doc bridge on the server.
        const editorText = editor.doc.get(
          PLATE_BRIDGE_ROOT_KEY,
          Y.XmlText,
        ) as Y.XmlText;
        editorText.insert(0, "hello from editor");

        // Poll until the commenter's shared type reflects the write (or bail
        // after 5s). Yjs broadcasts are fast; 500ms is usually plenty.
        const commenterText = commenter.doc.get(
          PLATE_BRIDGE_ROOT_KEY,
          Y.XmlText,
        ) as Y.XmlText;
        const deadline = Date.now() + 5000;
        while (
          !commenterText.toString().includes("hello from editor") &&
          Date.now() < deadline
        ) {
          await new Promise((r) => setTimeout(r, 100));
        }

        expect(commenterText.toString()).toContain("hello from editor");
      } finally {
        for (const p of providers) {
          try {
            p.destroy();
          } catch {
            /* swallow: teardown best-effort */
          }
        }
        if (harness) await harness.server.destroy();
        if (seed) await seed.cleanup();
      }
    },
    20_000,
  );
});
