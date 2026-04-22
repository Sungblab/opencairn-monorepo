import { describe, it, expect } from "vitest";
import { parseMentions, stripMentions } from "../src/lib/mention-parser.js";

describe("parseMentions", () => {
  it("extracts user/page/concept/date distinct tokens", () => {
    const body = "Hey @[user:u_1] see @[page:p_1] and @[concept:c_1] by @[date:2026-04-22].";
    const r = parseMentions(body);
    expect(r).toEqual([
      { type: "user", id: "u_1" },
      { type: "page", id: "p_1" },
      { type: "concept", id: "c_1" },
      { type: "date", id: "2026-04-22" },
    ]);
  });
  it("deduplicates", () => {
    expect(parseMentions("@[user:u_1] @[user:u_1]")).toEqual([{ type: "user", id: "u_1" }]);
  });
  it("rejects invalid tokens silently", () => {
    expect(parseMentions("@[bogus:x] @[user:]")).toEqual([]);
  });
  it("strips tokens for preview", () => {
    expect(stripMentions("hi @[user:u_1]!")).toBe("hi !");
  });
});
