import { describe, expect, it } from "vitest";
import { extractWsSlug } from "./extract-ws-slug";

describe("extractWsSlug", () => {
  it("returns the slug for a workspace-scoped path", () => {
    expect(extractWsSlug("/ko/app/w/acme/research")).toBe("acme");
    expect(extractWsSlug("/en/app/w/team-1")).toBe("team-1");
    // Trailing slash on the slug-only path
    expect(extractWsSlug("/ko/app/w/acme/")).toBe("acme");
  });

  it("returns null for non-workspace paths", () => {
    expect(extractWsSlug("/ko/settings/profile")).toBeNull();
    expect(extractWsSlug("/ko/onboarding")).toBeNull();
    expect(extractWsSlug("/ko/auth/login")).toBeNull();
    expect(extractWsSlug("/ko/s/share-token-abc")).toBeNull();
    expect(extractWsSlug("/ko")).toBeNull();
    expect(extractWsSlug("/")).toBeNull();
  });

  it("returns null for null/undefined/empty input", () => {
    expect(extractWsSlug(null)).toBeNull();
    expect(extractWsSlug(undefined)).toBeNull();
    expect(extractWsSlug("")).toBeNull();
  });

  it("does not partial-match `/app/w` mid-path", () => {
    expect(extractWsSlug("/ko/marketing/app/w/acme")).toBeNull();
  });
});
