import { describe, expect, it } from "vitest";

import {
  filterSlashCommands,
  getAgentCommand,
  parseSlashCommand,
} from "./agent-commands";

describe("agent commands", () => {
  it("parses slash commands and removes the command token from content", () => {
    expect(parseSlashCommand("/요약 핵심만")).toMatchObject({
      command: { id: "summarize" },
      content: "핵심만",
    });
  });

  it("exposes context patches for command-time payload overrides", () => {
    expect(getAgentCommand("web_search")?.contextPatch).toEqual({
      externalSearch: "allowed",
    });
  });

  it("stores prompt keys instead of resolved prompt text", () => {
    expect(getAgentCommand("summarize")).toMatchObject({
      promptKey: "summarize",
    });
    expect(getAgentCommand("summarize")).not.toHaveProperty("defaultPrompt");
  });

  it("normalizes slash command search input", () => {
    expect(filterSlashCommands("／요").map((command) => command.id)).toContain(
      "summarize",
    );
    expect(parseSlashCommand("／요약 핵심만")).toMatchObject({
      command: { id: "summarize" },
      content: "핵심만",
    });
  });

  it("keeps note narration scoped to the current document", () => {
    expect(parseSlashCommand("/narrate this note")).toMatchObject({
      command: {
        id: "narrate_note",
        contextPatch: { sourcePolicy: "current_only" },
      },
      content: "this note",
    });
  });
});
