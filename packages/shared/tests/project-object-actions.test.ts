import { describe, expect, it } from "vitest";
import {
  projectObjectActionSchema,
  projectObjectActionEventSchema,
} from "../src/project-object-actions";

const projectObjectId = "00000000-0000-4000-8000-000000000010";

describe("project object action contracts", () => {
  it("accepts a typed create action without caller-supplied workspace or user scope", () => {
    const parsed = projectObjectActionSchema.parse({
      type: "create_project_object",
      requestId: "00000000-0000-4000-8000-000000000001",
      object: {
        filename: "brief.md",
        kind: "markdown",
        mimeType: "text/markdown",
        content: "# Brief",
      },
    });

    expect(parsed.type).toBe("create_project_object");
    expect("workspaceId" in parsed).toBe(false);
    expect("userId" in parsed).toBe(false);
    expect("projectId" in parsed).toBe(false);
  });

  it("accepts update, export, and compile actions", () => {
    expect(
      projectObjectActionSchema.parse({
        type: "update_project_object_content",
        objectId: projectObjectId,
        content: "updated",
      }).type,
    ).toBe("update_project_object_content");

    expect(
      projectObjectActionSchema.parse({
        type: "export_project_object",
        objectId: projectObjectId,
        format: "pdf",
        provider: "opencairn_download",
      }).type,
    ).toBe("export_project_object");

    expect(
      projectObjectActionSchema.parse({
        type: "compile_project_object",
        objectId: projectObjectId,
        target: "pdf",
      }).type,
    ).toBe("compile_project_object");
  });

  it("rejects LLM-supplied scope fields on write actions", () => {
    expect(() =>
      projectObjectActionSchema.parse({
        type: "create_project_object",
        workspaceId: "00000000-0000-4000-8000-000000000002",
        object: {
          filename: "brief.md",
          content: "# Brief",
        },
      }),
    ).toThrow();

    expect(() =>
      projectObjectActionSchema.parse({
        type: "update_project_object_content",
        objectId: projectObjectId,
        projectId: "00000000-0000-4000-8000-000000000003",
        content: "updated",
      }),
    ).toThrow();
  });

  it("describes a typed project object creation event", () => {
    const parsed = projectObjectActionEventSchema.parse({
      type: "project_object_created",
      object: {
        id: projectObjectId,
        objectType: "agent_file",
        title: "Brief",
        filename: "brief.md",
        kind: "markdown",
        mimeType: "text/markdown",
        projectId: "00000000-0000-4000-8000-000000000011",
      },
    });

    expect(parsed.object.objectType).toBe("agent_file");
  });
});
