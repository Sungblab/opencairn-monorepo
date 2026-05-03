import { describe, expect, it } from "vitest";

import {
  importSourceSchema,
  markdownUploadUrlSchema,
  startMarkdownImportSchema,
} from "../src/import-types";

describe("markdown import schemas", () => {
  it("accepts markdown_zip as an import source", () => {
    expect(importSourceSchema.parse("markdown_zip")).toBe("markdown_zip");
  });

  it("validates markdown import start payload", () => {
    const parsed = startMarkdownImportSchema.parse({
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      zipObjectKey:
        "imports/markdown/550e8400-e29b-41d4-a716-446655440000/user_1/pkg.zip",
      originalName: "vault.zip",
      target: { kind: "new" },
    });

    expect(parsed.originalName).toBe("vault.zip");
  });

  it("caps markdown zip upload size", () => {
    expect(() =>
      markdownUploadUrlSchema.parse({
        workspaceId: "550e8400-e29b-41d4-a716-446655440000",
        size: 6 * 1024 * 1024 * 1024,
        originalName: "too-big.zip",
      }),
    ).toThrow();
  });
});
