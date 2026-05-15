import { describe, expect, it } from "vitest";
import { isLikelyInAppBrowser } from "./in-app-browser";

describe("isLikelyInAppBrowser", () => {
  it("detects common social app embedded browsers", () => {
    expect(
      isLikelyInAppBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 312.0",
      ),
    ).toBe(true);
    expect(
      isLikelyInAppBrowser(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A; wv) AppleWebKit/537.36",
      ),
    ).toBe(true);
    expect(isLikelyInAppBrowser("Mozilla/5.0 KAKAOTALK 10.7.0")).toBe(true);
  });

  it("does not flag normal Chrome or Safari browsers", () => {
    expect(
      isLikelyInAppBrowser(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ),
    ).toBe(false);
    expect(
      isLikelyInAppBrowser(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe(false);
  });
});
