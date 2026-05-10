// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LOCALE_COOKIE, writeLocaleCookie } from "./locale-cookie";

describe("locale-cookie", () => {
  it("writes the Next locale cookie for one year", () => {
    writeLocaleCookie("en");

    expect(document.cookie).toContain(`${LOCALE_COOKIE}=en`);
  });
});
