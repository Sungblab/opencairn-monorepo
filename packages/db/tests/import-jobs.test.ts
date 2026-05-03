import { describe, expect, it } from "vitest";

import { importSourceEnum } from "../src/index";

describe("import job schema", () => {
  it("declares markdown_zip as a one-shot import source", () => {
    expect(importSourceEnum.enumValues).toEqual([
      "google_drive",
      "notion_zip",
      "markdown_zip",
      "literature_search",
    ]);
  });
});
