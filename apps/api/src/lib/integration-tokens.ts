import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

// AES-256-GCM encrypt/decrypt for third-party OAuth tokens. Wire layout:
//   iv(12) || tag(16) || ciphertext
// Must stay byte-compatible with apps/worker/src/worker/lib/integration_crypto.py
// — both sides read/write user_integrations.access_token_encrypted.
//
// Key rotation (audit Tier 5 §5.2): when an operator rotates
// INTEGRATION_TOKEN_ENCRYPTION_KEY, they must first copy the previous key
// into INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD. decryptToken tries the current
// key first and falls back to _OLD; encryptToken always writes with the
// current key only, so once every existing blob has been migrated (either
// by background re-encryption or natural expiry) the operator can drop
// _OLD. See docs/contributing/byok-key-rotation.md.

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function decodeKey(raw: string, envName: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `${envName} must decode to 32 bytes (got ${key.length})`
    );
  }
  return key;
}

function getCurrentKey(): Buffer {
  const raw = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "INTEGRATION_TOKEN_ENCRYPTION_KEY is not set. " +
        "Generate a 32-byte base64 key and set it in your environment."
    );
  }
  return decodeKey(raw, "INTEGRATION_TOKEN_ENCRYPTION_KEY");
}

function getOldKey(): Buffer | null {
  const raw = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD;
  if (!raw) return null;
  return decodeKey(raw, "INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD");
}

function tryDecryptWith(
  key: Buffer,
  iv: Buffer,
  tag: Buffer,
  ct: Buffer
): string {
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    "utf8"
  );
}

export function encryptToken(plaintext: string): Buffer {
  const key = getCurrentKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function decryptToken(encrypted: Buffer): string {
  const iv = encrypted.subarray(0, IV_LEN);
  const tag = encrypted.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = encrypted.subarray(IV_LEN + TAG_LEN);

  const currentKey = getCurrentKey();
  try {
    return tryDecryptWith(currentKey, iv, tag, ct);
  } catch (currentErr) {
    // getOldKey() throws synchronously on a malformed _OLD env (wrong
    // length). That's an operator misconfig and must surface, not be
    // swallowed as a routine "wrong key" GCM auth failure.
    const oldKey = getOldKey();
    if (oldKey) {
      try {
        return tryDecryptWith(oldKey, iv, tag, ct);
      } catch {
        // Both keys failed. Fall through to re-throw currentErr so the
        // caller's error identity stays stable regardless of whether _OLD
        // was set — see docs/contributing/byok-key-rotation.md "Both keys
        // wrong". users.ts:165's `{registered: false}` branch depends on
        // this being the canonical current-key auth failure.
      }
    }
    throw currentErr;
  }
}
