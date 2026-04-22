import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

// AES-256-GCM encrypt/decrypt for third-party OAuth tokens. Wire layout:
//   iv(12) || tag(16) || ciphertext
// Must stay byte-compatible with apps/worker/src/worker/lib/integration_crypto.py
// — both sides read/write user_integrations.access_token_encrypted.

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "INTEGRATION_TOKEN_ENCRYPTION_KEY is not set. " +
        "Generate a 32-byte base64 key and set it in your environment."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `INTEGRATION_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length})`
    );
  }
  return key;
}

export function encryptToken(plaintext: string): Buffer {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function decryptToken(encrypted: Buffer): string {
  const key = getKey();
  const iv = encrypted.subarray(0, IV_LEN);
  const tag = encrypted.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = encrypted.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    "utf8"
  );
}
