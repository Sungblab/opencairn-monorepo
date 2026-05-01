import { describe, it, expect } from "vitest";
import { isSafeReturnTo } from "./return-to";

describe("isSafeReturnTo", () => {
  it("allows app routes", () => {
    expect(isSafeReturnTo("/dashboard")).toBe(true);
    expect(isSafeReturnTo("/workspace/my-team")).toBe(true);
    expect(isSafeReturnTo("/workspace/my-team/project/123")).toBe(true);
    expect(isSafeReturnTo("/settings/ai")).toBe(true);
  });

  it("allows /onboarding and /onboarding?invite=...", () => {
    expect(isSafeReturnTo("/onboarding")).toBe(true);
    expect(isSafeReturnTo("/onboarding?invite=abc123")).toBe(true);
  });

  it("allows locale-prefixed paths", () => {
    expect(isSafeReturnTo("/ko/dashboard")).toBe(true);
    expect(isSafeReturnTo("/ko/workspace/acme")).toBe(true);
    expect(isSafeReturnTo("/en/onboarding?invite=xyz")).toBe(true);
  });

  it("rejects external URLs", () => {
    expect(isSafeReturnTo("https://evil.com/phish")).toBe(false);
    expect(isSafeReturnTo("//evil.com")).toBe(false);
    expect(isSafeReturnTo("http://localhost:3000/workspace/acme")).toBe(false);
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
