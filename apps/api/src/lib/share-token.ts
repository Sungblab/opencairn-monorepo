import { randomBytes } from "node:crypto";

// 32 bytes = 256 bits of entropy. base64url is URL-safe (no /, +, =).
// Resulting string is 43 chars.
const TOKEN_BYTES = 32;
const TOKEN_LENGTH = 43;

export function generateShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

// Cheap format guard before the DB lookup. Real validation happens via
// the unique index hit. Reject obviously-malformed tokens early so a 1KB
// path param doesn't waste a query.
export function isValidShareTokenFormat(token: string): boolean {
  if (token.length !== TOKEN_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(token);
}
