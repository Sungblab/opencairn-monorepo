import { describe, expect, it } from "vitest";
import {
  TOOL_DISCOVERY_ITEMS,
  getToolDiscoveryGroups,
  getToolDiscoveryItemsForSurface,
} from "./tool-discovery-catalog";

describe("tool discovery capability registry", () => {
  it("keeps every capability projectable beyond a single UI surface", () => {
    for (const item of TOOL_DISCOVERY_ITEMS) {
      expect(item.supportedContexts.length, item.id).toBeGreaterThan(0);
      expect(item.outputType, item.id).toBeTruthy();
      expect(item.risk, item.id).toBeTruthy();
    }
  });

  it("still projects existing project home and agent tools groups", () => {
    expect(
      getToolDiscoveryGroups("project_home").flatMap((group) =>
        group.items.map((item) => item.id),
      ),
    ).toContain("pdf_report_fast");
    expect(
      getToolDiscoveryGroups("agent_tools").flatMap((group) =>
        group.items.map((item) => item.id),
      ),
    ).toContain("source_figure");
  });

  it("projects source, upload, sidebar, file explorer, and workflow surfaces from the same registry", () => {
    expect(
      getToolDiscoveryItemsForSurface("slash_command", {
        contexts: ["source"],
      }).map((item) => item.id),
    ).toEqual(
      expect.arrayContaining([
        "docx_report",
        "pptx_deck",
        "xlsx_table",
        "source_figure",
        "study_artifact_generator",
      ]),
    );
    expect(
      getToolDiscoveryItemsForSurface("source_rail", {
        contexts: ["source"],
      }).map((item) => item.id),
    ).toEqual(expect.arrayContaining(["pdf_report_fast", "source_figure"]));
    expect(
      getToolDiscoveryItemsForSurface("upload_intent", {
        contexts: ["upload_batch"],
      }).map((item) => item.id),
    ).toEqual(expect.arrayContaining(["docx_report", "pptx_deck", "xlsx_table"]));
    expect(
      getToolDiscoveryItemsForSurface("sidebar_command_rail", {
        contexts: ["project"],
      }).map((item) => item.id),
    ).toContain("import");
    expect(
      getToolDiscoveryItemsForSurface("file_explorer", {
        contexts: ["source"],
        contentType: "application/pdf",
      }).map((item) => item.id),
    ).toContain("pdf_report_fast");
    expect(
      getToolDiscoveryItemsForSurface("workflow_console", {
        contexts: ["workflow_run"],
      }).map((item) => item.id),
    ).toEqual(expect.arrayContaining(["runs", "review_inbox"]));
  });

  it("marks sidebar command rail items with their sidebar section instead of relying on component-local id filters", () => {
    const sidebarItems = getToolDiscoveryItemsForSurface("sidebar_command_rail", {
      contexts: ["project"],
    });

    expect(
      sidebarItems
        .filter((item) => item.sidebarSection === "workflow")
        .map((item) => item.id),
    ).toEqual(expect.arrayContaining(["literature", "pdf_report_fast"]));
    expect(
      sidebarItems
        .filter((item) => item.sidebarSection === "review")
        .map((item) => item.id),
    ).toEqual(["runs", "review_inbox"]);
  });
});
