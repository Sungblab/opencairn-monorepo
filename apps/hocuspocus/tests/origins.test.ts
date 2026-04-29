import http from "node:http";
import { Server } from "@hocuspocus/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAllowedOrigin } from "../src/config.js";

// S1-003 — `HOCUSPOCUS_ORIGINS` must actually gate the WS upgrade. The
// production server.ts wires this via an `onUpgrade` hook that compares
// `request.headers.origin` against the allowlist, writes 403 to the socket,
// and aborts the upgrade. These tests boot a real Hocuspocus server with
// the same hook wiring and drive raw HTTP upgrade requests against it so a
// regression in the hook surface (or in @hocuspocus/server's hook
// machinery) immediately shows up.
//
// We avoid using @hocuspocus/provider because the WHATWG WebSocket API
// (and its Node 22 global) provides no way to set the `Origin` header
// from JS. Raw `http.request` is the only deterministic path.

const ALLOWED = ["http://allowed.example.com"];

function makeServer() {
  return new Server({
    port: 0,
    address: "127.0.0.1",
    stopOnSignals: false,
    quiet: true,
    async onUpgrade({ request, socket }) {
      const origin = request.headers.origin;
      if (!isAllowedOrigin(origin, ALLOWED)) {
        socket.write(
          "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
        socket.destroy();
        // Hocuspocus's setupHttpUpgrade catches the hook rejection and
        // unconditionally rethrows truthy errors as unhandled rejections on
        // the EventEmitter listener. Throwing a falsy value short-circuits
        // the upgrade (skipping webSocketServer.handleUpgrade) without the
        // noisy stack trace; the socket is already cleanly destroyed.
        // eslint-disable-next-line no-throw-literal
        throw null;
      }
    },
  });
}

interface UpgradeOutcome {
  status: number | null;
  upgraded: boolean;
  closed: boolean;
}

function attemptUpgrade(
  port: number,
  origin: string | undefined,
): Promise<UpgradeOutcome> {
  return new Promise<UpgradeOutcome>((resolve) => {
    const headers: Record<string, string> = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
    };
    if (origin !== undefined) headers.Origin = origin;

    const req = http.request({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/",
      headers,
    });

    let settled = false;
    const finish = (outcome: UpgradeOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    req.on("upgrade", (res, socket) => {
      socket.destroy();
      finish({ status: res.statusCode ?? null, upgraded: true, closed: false });
    });
    req.on("response", (res) => {
      res.resume();
      finish({
        status: res.statusCode ?? null,
        upgraded: false,
        closed: false,
      });
    });
    req.on("error", () => {
      finish({ status: null, upgraded: false, closed: true });
    });
    req.end();

    setTimeout(() => finish({ status: null, upgraded: false, closed: true }), 2_000);
  });
}

describe("hocuspocus origin allowlist", () => {
  let server: Server | null = null;
  let port = 0;
  // M-1 from review — the production server (and this test) abort the
  // upgrade via `throw null`, which @hocuspocus/server's setupHttpUpgrade
  // catches and silently swallows because of `if (error) throw error;`.
  // Pin that contract: if a future upstream version flips the check (e.g.
  // `error !== undefined`), the rejected hook would emit an unhandled
  // rejection on the EventEmitter listener and we'd start surfacing
  // warnings on every blocked connection. Trip the test in that case.
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => {
    rejections.push(reason);
  };

  beforeEach(async () => {
    rejections.length = 0;
    process.on("unhandledRejection", onRejection);
    server = makeServer();
    await server.listen();
    port = server.address.port;
  });

  afterEach(async () => {
    process.off("unhandledRejection", onRejection);
    if (server) {
      await server.destroy();
      server = null;
    }
  });

  it("rejects WS upgrade from a disallowed origin", async () => {
    const r = await attemptUpgrade(port, "https://evil.example.com");
    expect(r.upgraded).toBe(false);
    // Give the EventEmitter a tick to surface any swallowed rejection.
    await new Promise((r) => setTimeout(r, 50));
    expect(rejections).toEqual([]);
  });

  it("rejects WS upgrade with no Origin header at all", async () => {
    const r = await attemptUpgrade(port, undefined);
    expect(r.upgraded).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(rejections).toEqual([]);
  });

  it("upgrades WS request from an allowed origin", async () => {
    const r = await attemptUpgrade(port, "http://allowed.example.com");
    expect(r.upgraded).toBe(true);
    expect(r.status).toBe(101);
    await new Promise((r) => setTimeout(r, 50));
    expect(rejections).toEqual([]);
  });
});
