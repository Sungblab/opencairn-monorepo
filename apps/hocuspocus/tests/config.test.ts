import { describe, expect, it } from "vitest";
import { isAllowedOrigin, loadEnv } from "../src/config.js";

describe("loadEnv", () => {
  it("parses HOCUSPOCUS_ORIGINS as a trimmed origin allow-list", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/opencairn",
      BETTER_AUTH_SECRET: "x".repeat(32),
      HOCUSPOCUS_ORIGINS: "http://localhost:3000, https://app.example.com ,,",
    });

    expect(env.HOCUSPOCUS_ORIGINS).toEqual([
      "http://localhost:3000",
      "https://app.example.com",
    ]);
    expect(
      isAllowedOrigin("https://app.example.com", env.HOCUSPOCUS_ORIGINS),
    ).toBe(true);
    expect(
      isAllowedOrigin("https://evil.example.com", env.HOCUSPOCUS_ORIGINS),
    ).toBe(false);
    expect(isAllowedOrigin(undefined, env.HOCUSPOCUS_ORIGINS)).toBe(false);
  });
});
