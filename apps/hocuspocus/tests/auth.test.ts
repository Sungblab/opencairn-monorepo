import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, user, eq } from "@opencairn/db";
import { db as apiDb } from "@opencairn/db";
import { randomUUID } from "node:crypto";
import { makePermissionsAdapter } from "../src/permissions-adapter.js";
import { makeAuthenticate, makeVerifySession } from "../src/auth.js";
import {
  seedMultiRoleWorkspace,
  createUser,
  type SeedMultiRoleResult,
} from "../../api/tests/helpers/seed.js";
import { signSessionForUser } from "../../api/src/lib/test-session.js";

// Plan 2B Task 11 tests. Confirms:
// 1. role → readOnly mapping (editor=false, commenter=true, viewer=true)
// 2. invalid session → unauthenticated
// 3. valid session but outsider on the note → forbidden
// 4. docname that isn't `page:<uuid>` → unsupported_document_name
// 5. valid Cookie-header form is parsed (not just bare signed value)
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

describe("makeAuthenticate", () => {
  let seed: SeedMultiRoleResult;
  let extraUserIds: string[] = [];
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
    extraUserIds = [];
  });
  afterEach(async () => {
    for (const uid of extraUserIds) {
      await apiDb.delete(user).where(eq(user.id, uid)).catch(() => {});
    }
    await seed.cleanup();
  });

  it("editor → readOnly false", async () => {
    const { cookieHeader } = await signSessionForUser(seed.editorUserId);
    const r = await authenticate({
      documentName: `page:${seed.noteId}`,
      token: cookieHeader,
    });
    expect(r.readOnly).toBe(false);
    expect(r.userId).toBe(seed.editorUserId);
    expect(r.userName).toBeTypeOf("string");
  });

  it("commenter → readOnly true", async () => {
    const { cookieHeader } = await signSessionForUser(seed.commenterUserId);
    const r = await authenticate({
      documentName: `page:${seed.noteId}`,
      token: cookieHeader,
    });
    expect(r.readOnly).toBe(true);
    expect(r.userId).toBe(seed.commenterUserId);
  });

  it("viewer → readOnly true", async () => {
    const { cookieHeader } = await signSessionForUser(seed.viewerUserId);
    const r = await authenticate({
      documentName: `page:${seed.noteId}`,
      token: cookieHeader,
    });
    expect(r.readOnly).toBe(true);
    expect(r.userId).toBe(seed.viewerUserId);
  });

  it("multi-cookie Cookie header is parsed", async () => {
    const { cookieHeader } = await signSessionForUser(seed.editorUserId);
    const header = `theme=dark; ${cookieHeader}; locale=ko`;
    const r = await authenticate({
      documentName: `page:${seed.noteId}`,
      token: header,
    });
    expect(r.readOnly).toBe(false);
    expect(r.userId).toBe(seed.editorUserId);
  });

  it("no session → throws unauthenticated", async () => {
    await expect(
      authenticate({
        documentName: `page:${seed.noteId}`,
        token: "better-auth.session_token=bogus.aGVsbG8=",
      }),
    ).rejects.toThrow(/unauthenticated/);
  });

  it("empty token → throws unauthenticated", async () => {
    await expect(
      authenticate({ documentName: `page:${seed.noteId}`, token: "" }),
    ).rejects.toThrow(/unauthenticated/);
  });

  // S1-002 — Browsers cannot read httpOnly cookies via document.cookie, so
  // the @hocuspocus/provider client cannot put the Better Auth session into
  // the AUTH-message `token` field. The browser DOES send the cookie in the
  // WS upgrade request, however, so the server must fall back to
  // `requestHeaders.cookie` (passed as `cookieHeader`) when token is empty.
  it("empty token + valid cookieHeader → authenticates from cookie", async () => {
    const { cookieHeader } = await signSessionForUser(seed.editorUserId);
    const r = await authenticate({
      documentName: `page:${seed.noteId}`,
      token: "",
      cookieHeader: `theme=dark; ${cookieHeader}; locale=ko`,
    });
    expect(r.readOnly).toBe(false);
    expect(r.userId).toBe(seed.editorUserId);
  });

  it("non-cookie token + valid cookieHeader → authenticates from cookie", async () => {
    // The new client passes a sentinel like "ws-auth-fallback" that exists
    // only to trigger the AUTH handshake — the server must skip it and use
    // the upgrade Cookie header instead of throwing.
    const { cookieHeader } = await signSessionForUser(seed.editorUserId);
    const r = await authenticate({
      documentName: `page:${seed.noteId}`,
      token: "ws-auth-fallback",
      cookieHeader,
    });
    expect(r.userId).toBe(seed.editorUserId);
  });

  it("empty token + empty cookieHeader → throws unauthenticated", async () => {
    await expect(
      authenticate({
        documentName: `page:${seed.noteId}`,
        token: "",
        cookieHeader: "theme=dark; locale=ko",
      }),
    ).rejects.toThrow(/unauthenticated/);
  });

  it("tampered HMAC → throws unauthenticated", async () => {
    const { cookieHeader } = await signSessionForUser(seed.editorUserId);
    // Flip the last non-`=` byte of the signature to force HMAC mismatch.
    const tampered = cookieHeader.replace(
      /([A-Za-z0-9+/])(=*)$/,
      (_, c: string, eq: string) =>
        (c === "A" ? "B" : "A") + eq,
    );
    await expect(
      authenticate({
        documentName: `page:${seed.noteId}`,
        token: tampered,
      }),
    ).rejects.toThrow(/unauthenticated/);
  });

  it("outsider (valid session, no workspace access) → throws forbidden", async () => {
    const outsider = await createUser();
    extraUserIds.push(outsider.id);
    const { cookieHeader } = await signSessionForUser(outsider.id);
    await expect(
      authenticate({
        documentName: `page:${seed.noteId}`,
        token: cookieHeader,
      }),
    ).rejects.toThrow(/forbidden/);
  });

  it("malformed documentName → throws unsupported_document_name", async () => {
    const { cookieHeader } = await signSessionForUser(seed.editorUserId);
    await expect(
      authenticate({ documentName: "workspace:foo", token: cookieHeader }),
    ).rejects.toThrow(/unsupported_document_name/);
  });

  it("docname without uuid → throws unsupported_document_name", async () => {
    const { cookieHeader } = await signSessionForUser(seed.editorUserId);
    await expect(
      authenticate({ documentName: "page:not-a-uuid", token: cookieHeader }),
    ).rejects.toThrow(/unsupported_document_name/);
  });
});
