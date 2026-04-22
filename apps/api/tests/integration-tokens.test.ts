import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptToken, decryptToken } from "../src/lib/integration-tokens";

const TEST_KEY = Buffer.alloc(32, 0x42).toString("base64");

describe("integration-tokens", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = savedKey;
    } else {
      delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
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
});
