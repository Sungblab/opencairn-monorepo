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

  it("exposes context patches for source-backed command payload overrides", () => {
    expect(getAgentCommand("paper_search")?.contextPatch).toEqual({
      externalSearch: "allowed",
    });
  });

  it("defaults source-backed note commands to project sources and grounding", () => {
    expect(getAgentCommand("make_note")?.contextPatch).toEqual({
      sourcePolicy: "auto_project",
      memoryPolicy: "auto",
      externalSearch: "allowed",
    });
    expect(getAgentCommand("extract_citations")?.contextPatch).toEqual({
      sourcePolicy: "auto_project",
      memoryPolicy: "auto",
      externalSearch: "allowed",
    });
  });

  it("stores prompt keys instead of resolved prompt text", () => {
    expect(getAgentCommand("summarize")).toMatchObject({
      promptKey: "summarize",
    });
    expect(getAgentCommand("summarize")).not.toHaveProperty("defaultPrompt");
  });

  it("does not expose web search as a manual command", () => {
    expect(filterSlashCommands("web").map((command) => command.id)).not.toContain(
      "web_search",
    );
    expect(parseSlashCommand("/web latest")).toBeNull();
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

  it("exposes figure generation through slash command discovery", () => {
    expect(filterSlashCommands("figure").map((command) => command.id)).toContain(
      "generate_figure",
    );
    expect(filterSlashCommands("이미지").map((command) => command.id)).toContain(
      "generate_figure",
    );
    expect(parseSlashCommand("/피규어 관계도")).toMatchObject({
      command: {
        id: "generate_figure",
        contextPatch: { sourcePolicy: "auto_project" },
      },
      content: "관계도",
    });
  });

  it("enriches slash discovery from the shared tool registry", () => {
    expect(filterSlashCommands("cheat").map((command) => command.id)).toContain(
      "summarize",
    );
    expect(getAgentCommand("generate_figure")).toMatchObject({
      registryItemId: "source_figure",
      registryOutputType: "agent_file",
    });
  });
});
