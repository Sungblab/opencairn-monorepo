import { describe, expect, it } from "vitest";
import { buildRuntimeContext } from "../../src/lib/chat-runtime-context.js";

describe("buildRuntimeContext", () => {
  it("injects exact server time, locale, and timezone", () => {
    const now = new Date("2026-04-30T14:30:00.000Z");
    const context = buildRuntimeContext({
      now,
      locale: "ko",
      timezone: "Asia/Seoul",
    });

    expect(context).toContain("Current server time: 2026-04-30T14:30:00.000Z");
    expect(context).toContain("User locale: ko");
    expect(context).toContain("User timezone: Asia/Seoul");
  });

  it("orders server time above model prior knowledge", () => {
    const context = buildRuntimeContext({
      now: new Date("2026-04-30T00:00:00.000Z"),
    });

    expect(context).toContain(
      "Server current time outranks model training data and internal date assumptions.",
    );
    expect(context).toContain(
      "Resolve relative dates such as today, yesterday, tomorrow, latest, and recent from the server time above.",
    );
  });
});
