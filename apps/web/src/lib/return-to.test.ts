import { describe, it, expect } from "vitest";
import { isSafeReturnTo } from "./return-to";

describe("isSafeReturnTo", () => {
  it("allows /app and /app/**", () => {
    expect(isSafeReturnTo("/app")).toBe(true);
    expect(isSafeReturnTo("/app/w/my-team")).toBe(true);
    expect(isSafeReturnTo("/app/w/my-team/p/123")).toBe(true);
  });

  it("allows /onboarding and /onboarding?invite=...", () => {
    expect(isSafeReturnTo("/onboarding")).toBe(true);
    expect(isSafeReturnTo("/onboarding?invite=abc123")).toBe(true);
  });

  it("allows locale-prefixed paths", () => {
    expect(isSafeReturnTo("/ko/app")).toBe(true);
    expect(isSafeReturnTo("/en/onboarding?invite=xyz")).toBe(true);
  });

  it("rejects external URLs", () => {
    expect(isSafeReturnTo("https://evil.com/phish")).toBe(false);
    expect(isSafeReturnTo("//evil.com")).toBe(false);
    expect(isSafeReturnTo("http://localhost:3000/app")).toBe(false);
  });

  it("rejects non-whitelisted paths", () => {
    expect(isSafeReturnTo("/auth/login")).toBe(false);
    expect(isSafeReturnTo("/foo")).toBe(false);
    expect(isSafeReturnTo("/")).toBe(false);
  });

  it("rejects empty / nullish", () => {
    expect(isSafeReturnTo("")).toBe(false);
    expect(isSafeReturnTo(null as unknown as string)).toBe(false);
  });
});
