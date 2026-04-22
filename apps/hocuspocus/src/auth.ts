import { and, eq, gt } from "@opencairn/db";
import type { DB } from "@opencairn/db";
import { session as sessionTable, user as userTable } from "@opencairn/db";
import type { PermissionsAdapter } from "./permissions-adapter.js";
import { logger } from "./logger.js";

// Plan 2B Task 11: Hocuspocus onAuthenticate.
//
// Verifies a Better Auth session cookie (HMAC-signed by BETTER_AUTH_SECRET),
// looks up the session row, and resolves the caller's role on the note that
// maps to `documentName`. Commenter + Viewer both receive readOnly=true for
// the Yjs surface — commenter writes land in the DB via the HTTP comments
// endpoints, not as Y.XmlFragment block edits.
//
// The design uses injected `verifySession` + `resolveRole` (rather than
// constructing a full Better Auth instance in-process). This keeps hocuspocus
// decoupled from Better Auth's plugin wiring and lets tests stub either half.

export interface AuthContext {
  userId: string;
  userName: string | null;
  readOnly: boolean;
}

export interface VerifiedSession {
  userId: string;
  name: string | null;
}

export interface AuthDeps {
  resolveRole: PermissionsAdapter["resolveRole"];
  verifySession: (token: string) => Promise<VerifiedSession | null>;
}

// page:<uuid> — any other docname (workspace:*, project:*, etc.) is rejected.
const DOC_RE =
  /^page:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function makeAuthenticate({ resolveRole, verifySession }: AuthDeps) {
  return async function authenticate(payload: {
    documentName: string;
    token: string;
  }): Promise<AuthContext> {
    const { documentName, token } = payload;
    const m = DOC_RE.exec(documentName);
    if (!m) throw new Error("unsupported_document_name");
    const noteId = m[1]!;

    const session = await verifySession(token);
    if (!session) throw new Error("unauthenticated");

    const role = await resolveRole(session.userId, {
      type: "note",
      id: noteId,
    });
    if (role === "none") throw new Error("forbidden");

    const readOnly = role === "viewer" || role === "commenter";
    logger.info(
      { userId: session.userId, doc: documentName, role, readOnly },
      "ws authenticate",
    );
    return {
      userId: session.userId,
      userName: session.name,
      readOnly,
    };
  };
}

// ────────────────────────────────────────────────────────────────────────────
// verifySession — Better Auth session cookie reader.
//
// Better Auth's cookie format (matches Hono's `serializeSigned`):
//   name:  better-auth.session_token
//   value: URL-encode( `<token>.<base64(HMAC-SHA256(token, secret))>` )
//
// The client sends either the bare signed value OR a full `Cookie:` header
// (e.g. `foo=bar; better-auth.session_token=<signed>`). We tolerate both.
// ────────────────────────────────────────────────────────────────────────────

const COOKIE_NAME = "better-auth.session_token";

export interface VerifySessionDeps {
  db: DB;
  secret: string;
}

export function makeVerifySession({
  db,
  secret,
}: VerifySessionDeps): AuthDeps["verifySession"] {
  return async function verifySession(raw: string) {
    if (!raw) return null;
    const signed = extractSignedValue(raw);
    if (!signed) return null;
    const token = await unsignCookieValue(signed, secret);
    if (!token) return null;

    const [row] = await db
      .select({
        userId: sessionTable.userId,
        name: userTable.name,
      })
      .from(sessionTable)
      .innerJoin(userTable, eq(userTable.id, sessionTable.userId))
      .where(
        and(
          eq(sessionTable.token, token),
          gt(sessionTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) return null;
    return { userId: row.userId, name: row.name ?? null };
  };
}

// Accepts either `name=value; other=foo` or a bare `<token>.<hmac>` (already
// URL-decoded) or the URL-encoded form of the bare value. Returns the raw
// signed string ready for HMAC verification, or null if no candidate found.
function extractSignedValue(raw: string): string | null {
  // Try as Cookie header first: look for `better-auth.session_token=...`.
  // Cookie values may be URL-encoded — decode before returning.
  if (raw.includes("=")) {
    const pairs = raw.split(";");
    for (const pair of pairs) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      if (name !== COOKIE_NAME) continue;
      let value = pair.slice(eq + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      try {
        return value.includes("%") ? decodeURIComponent(value) : value;
      } catch {
        return null;
      }
    }
    // Cookie header present but no matching name.
    return null;
  }
  // Bare signed value. Decode in case caller URL-encoded it.
  try {
    return raw.includes("%") ? decodeURIComponent(raw) : raw;
  } catch {
    return null;
  }
}

// HMAC-SHA256 verify, byte-for-byte compatible with Hono's serializeSigned.
// Hono uses `btoa` on the raw signature → standard base64 (not base64url).
async function unsignCookieValue(
  signed: string,
  secret: string,
): Promise<string | null> {
  const dot = signed.lastIndexOf(".");
  if (dot < 1) return null;
  const value = signed.slice(0, dot);
  const signature = signed.slice(dot + 1);
  // Hono signature is 32 bytes → 44-char base64 ending in `=`.
  if (signature.length !== 44 || !signature.endsWith("=")) return null;

  let sigBuf: ArrayBuffer;
  try {
    const bin = atob(signature);
    const tmp = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) tmp[i] = bin.charCodeAt(i);
    sigBuf = tmp.buffer.slice(
      tmp.byteOffset,
      tmp.byteOffset + tmp.byteLength,
    ) as ArrayBuffer;
  } catch {
    return null;
  }

  const secretBytes = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes.buffer.slice(
      secretBytes.byteOffset,
      secretBytes.byteOffset + secretBytes.byteLength,
    ) as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valueBytes = new TextEncoder().encode(value);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBuf,
    valueBytes.buffer.slice(
      valueBytes.byteOffset,
      valueBytes.byteOffset + valueBytes.byteLength,
    ) as ArrayBuffer,
  );
  return ok ? value : null;
}
