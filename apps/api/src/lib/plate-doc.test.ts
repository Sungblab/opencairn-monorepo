import { describe, expect, it } from "vitest";
import { textToPlateValue } from "./plate-doc";

describe("textToPlateValue", () => {
  it("stores generated source note content as a Plate value array", () => {
    const value = textToPlateValue("# PDF title\n\nExtracted body");

    expect(Array.isArray(value)).toBe(true);
    expect(value).toEqual([
      {
        type: "p",
        children: [{ text: "# PDF title\n\nExtracted body" }],
      },
    ]);
  });
});
