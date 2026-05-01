import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function isConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
}

function stateSecret(): Buffer {
  const raw = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "INTEGRATION_TOKEN_ENCRYPTION_KEY missing — required to sign OAuth state",
    );
  }
  return Buffer.from(raw, "base64");
}

export function signState(payload: {
  userId: string;
  workspaceId: string;
  locale?: string;
}): string {
  const nonce = randomBytes(12).toString("hex");
  const body = Buffer.from(
    JSON.stringify({ ...payload, nonce, ts: Date.now() }),
  ).toString("base64url");
  const sig = createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string): {
  userId: string;
  workspaceId: string;
  locale?: string;
  nonce: string;
  ts: number;
} {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("malformed state");
  const expected = createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("state signature mismatch");
  }
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (typeof parsed.ts !== "number" || Date.now() - parsed.ts > STATE_TTL_MS) {
    throw new Error("state expired");
  }
  return parsed;
}

export function authorizationUrl(state: string, redirectUri: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `${DRIVE_FILE_SCOPE} ${EMAIL_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${p.toString()}`;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`google token exchange failed: ${res.status}`);
  }
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
}

export async function fetchAccountEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("userinfo fetch failed");
  const { email } = (await res.json()) as { email: string };
  return email;
}

export async function revokeToken(accessToken: string): Promise<void> {
  await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: accessToken }),
  }).catch(() => {
    // Best-effort. Google returns 200 for already-invalid tokens and we don't
    // want a transient network blip to block the disconnect UI flow.
  });
}
