import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  legacyXmlStringToPlainText,
  transformYjsStateWithPlateValue,
  yDocToPlateValue,
  yjsStateToPlateValue,
} from "./yjs-plate-transform";

describe("Yjs Plate transform", () => {
  it("applies a draft Plate value through the canonical Yjs content root", () => {
    const empty = new Y.Doc();
    const currentState = Y.encodeStateAsUpdate(empty);

    const transformed = transformYjsStateWithPlateValue({
      currentState,
      draft: [
        {
          type: "p",
          id: "stable-block-id",
          children: [{ text: "updated draft" }],
        },
      ],
    });

    const decoded = yjsStateToPlateValue(transformed.state);
    expect(decoded).toEqual([
      {
        type: "p",
        id: "stable-block-id",
        children: [{ text: "updated draft" }],
      },
    ]);
    expect(Buffer.from(transformed.stateVector).toString("base64").length).toBeGreaterThan(0);
  });

  it("returns a fresh empty Plate value for empty Yjs roots", () => {
    const first = yDocToPlateValue(new Y.Doc());
    const second = yDocToPlateValue(new Y.Doc());

    first[0]!.children = [{ text: "mutated" }];

    expect(second).toEqual([{ type: "p", children: [{ text: "" }] }]);
  });

  it("removes reintroduced legacy XML tags when falling back to plain text", () => {
    expect(
      legacyXmlStringToPlainText(
        "<scrip<script>t>alert(1)</scrip</script>t>visible",
      ),
    ).not.toContain("<script>");
  });
});
