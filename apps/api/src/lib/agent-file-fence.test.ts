import { describe, expect, it } from "vitest";
import { extractAgentFileFence } from "./agent-file-fence";

describe("extractAgentFileFence", () => {
  it("extracts the last valid agent-file fence", () => {
    const parsed = extractAgentFileFence([
      "생성했습니다.",
      "```agent-file",
      JSON.stringify({
        files: [
          {
            filename: "paper.tex",
            kind: "latex",
            content: "\\documentclass{article}",
          },
        ],
      }),
      "```",
    ].join("\n"));

    expect(parsed?.files[0]?.filename).toBe("paper.tex");
  });

  it("rejects invalid JSON", () => {
    expect(extractAgentFileFence("```agent-file\n{bad}\n```")).toBeNull();
  });

  it("rejects unsafe filenames through the shared contract", () => {
    const parsed = extractAgentFileFence([
      "```agent-file",
      JSON.stringify({ files: [{ filename: "../x.txt", content: "x" }] }),
      "```",
    ].join("\n"));

    expect(parsed).toBeNull();
  });
});
