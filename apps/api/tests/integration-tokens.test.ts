import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptToken, decryptToken } from "../src/lib/integration-tokens";

const TEST_KEY = Buffer.alloc(32, 0x42).toString("base64");
const ROTATED_KEY = Buffer.alloc(32, 0x77).toString("base64");

describe("integration-tokens", () => {
  let savedKey: string | undefined;
  let savedOldKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
    savedOldKey = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD;
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = savedKey;
    } else {
      delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
    }
    if (savedOldKey !== undefined) {
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD = savedOldKey;
    } else {
      delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD;
    }
  });

  it("roundtrips a token through encrypt/decrypt", () => {
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    const plaintext = "ya29.a0Abc-verylong-oauth-token-xyz";
    const encrypted = encryptToken(plaintext);
    expect(encrypted).toBeInstanceOf(Buffer);
    expect(encrypted.length).toBeGreaterThan(12 + 16);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("fails loudly when key is missing", () => {
    delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(
      /INTEGRATION_TOKEN_ENCRYPTION_KEY/
    );
  });

  it("fails when decrypting with wrong key", () => {
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    const encrypted = encryptToken("hello");
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = Buffer.alloc(
      32,
      0x99
    ).toString("base64");
    expect(() => decryptToken(encrypted)).toThrow();
  });

  it("fails when key length is wrong", () => {
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY =
      Buffer.alloc(16).toString("base64");
    expect(() => encryptToken("x")).toThrow(/32 bytes/);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    const a = encryptToken("same");
    const b = encryptToken("same");
    expect(a.equals(b)).toBe(false);
  });

  describe("key rotation (audit Tier 5 §5.2)", () => {
    it("decrypts blob from previous key when _OLD env is set", () => {
      // Encrypt with the original key.
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
      delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD;
      const blob = encryptToken("oauth-token-pre-rotation");

      // Operator rotates: new key becomes current, old key moves to _OLD.
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = ROTATED_KEY;
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD = TEST_KEY;

      // Existing blob still decrypts via fallback.
      expect(decryptToken(blob)).toBe("oauth-token-pre-rotation");
    });

    it("encrypts only with the current key, never with _OLD", () => {
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = ROTATED_KEY;
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD = TEST_KEY;
      const blob = encryptToken("written-after-rotation");

      // Drop the old key — blob must still decrypt because it was written
      // with the current key, not the old one.
      delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD;
      expect(decryptToken(blob)).toBe("written-after-rotation");
    });

    it("fails when blob matches neither current nor _OLD", () => {
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
      const blob = encryptToken("orphan");

      // Both current and _OLD are unrelated to the blob.
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = Buffer.alloc(
        32,
        0x11
      ).toString("base64");
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD = Buffer.alloc(
        32,
        0x22
      ).toString("base64");
      expect(() => decryptToken(blob)).toThrow();
    });

    it("re-throws the current key's error (not _OLD's) when both fail", () => {
      // Capture the canonical current-key error first by decrypting a
      // garbage blob with no _OLD set — this is what callers like
      // users.ts:165 expect to see.
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
      delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD;
      const blob = encryptToken("orphan");

      let baselineErr: unknown;
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = Buffer.alloc(
        32,
        0x11
      ).toString("base64");
      try {
        decryptToken(blob);
      } catch (e) {
        baselineErr = e;
      }
      expect(baselineErr).toBeInstanceOf(Error);

      // Same scenario but _OLD is set to a different unrelated key — the
      // doc promises we still surface the *current* key's error. (Both
      // throws are GCM auth failures so message-equality is the right
      // check; identity differs because each tryDecrypt builds its own.)
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD = Buffer.alloc(
        32,
        0x22
      ).toString("base64");
      let withOldErr: unknown;
      try {
        decryptToken(blob);
      } catch (e) {
        withOldErr = e;
      }
      expect(withOldErr).toBeInstanceOf(Error);
      expect((withOldErr as Error).message).toBe(
        (baselineErr as Error).message
      );
    });

    it("works without _OLD set (single-key fallback path)", () => {
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
      delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD;
      const blob = encryptToken("single-key");
      expect(decryptToken(blob)).toBe("single-key");
    });

    it("rejects malformed _OLD key length at decrypt time", () => {
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = ROTATED_KEY;
      const blob = encryptToken("anything");
      // Operator typo: _OLD is 16 bytes instead of 32.
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = Buffer.alloc(
        32,
        0x11
      ).toString("base64");
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD =
        Buffer.alloc(16).toString("base64");
      expect(() => decryptToken(blob)).toThrow(/32 bytes/);
    });
  });
});
