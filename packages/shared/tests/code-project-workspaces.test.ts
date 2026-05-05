import { describe, expect, it } from "vitest";
import {
  codeWorkspaceCreateRequestSchema,
  codeWorkspaceCommandRunRequestSchema,
  codeWorkspaceManifestSchema,
  codeWorkspacePatchSchema,
  codeWorkspacePackageResultSchema,
  codeWorkspaceSnapshotSchema,
  normalizeCodeWorkspacePath,
} from "../src/code-project-workspaces";

const baseSnapshotId = "00000000-0000-4000-8000-000000000101";

describe("code project workspace contracts", () => {
  it("normalizes a safe manifest and rejects caller-supplied scope", () => {
    const parsed = codeWorkspaceCreateRequestSchema.parse({
      requestId: "00000000-0000-4000-8000-000000000001",
      name: "Demo app",
      description: "A small React demo",
      language: "typescript",
      framework: "react",
      manifest: {
        entries: [
          { path: "src", kind: "directory" },
          {
            path: "src/App.tsx",
            kind: "file",
            language: "tsx",
            mimeType: "text/typescript-jsx",
            bytes: 128,
            contentHash: "sha256:app",
            inlineContent: "export function App() { return null; }",
          },
        ],
      },
    });

    expect(parsed.manifest.entries.map((entry) => entry.path)).toEqual([
      "src",
      "src/App.tsx",
    ]);
    expect(() =>
      codeWorkspaceCreateRequestSchema.parse({
        workspaceId: "00000000-0000-4000-8000-000000000002",
        name: "Scoped by caller",
        manifest: { entries: [] },
      }),
    ).toThrow(/scope_fields_are_server_injected/);
  });

  it("rejects traversal, absolute paths, duplicate paths, and windows collisions", () => {
    expect(() => normalizeCodeWorkspacePath("../secret.txt")).toThrow(/path_cannot_traverse/);
    expect(() => normalizeCodeWorkspacePath("/absolute.txt")).toThrow(/path_must_be_relative/);
    expect(() => normalizeCodeWorkspacePath("C:/temp/file.txt")).toThrow(/path_must_not_include_drive_letter/);

    expect(() =>
      codeWorkspaceManifestSchema.parse({
        entries: [
          { path: "src/App.tsx", kind: "file", bytes: 1, contentHash: "sha256:a" },
          { path: "src/app.tsx", kind: "file", bytes: 1, contentHash: "sha256:b" },
        ],
      }),
    ).toThrow(/duplicate_path_collision/);
  });

  it("enforces manifest bounds before storage", () => {
    const tooDeep = Array.from({ length: 17 }, (_, index) => `d${index}`).join("/");
    const tooLong = `${"a".repeat(513)}.ts`;

    expect(() =>
      codeWorkspaceManifestSchema.parse({
        entries: [{ path: `${tooDeep}/file.ts`, kind: "file", bytes: 1, contentHash: "sha256:x" }],
      }),
    ).toThrow(/path_depth_exceeded/);

    expect(() =>
      codeWorkspaceManifestSchema.parse({
        entries: [{ path: tooLong, kind: "file", bytes: 1, contentHash: "sha256:x" }],
      }),
    ).toThrow(/path_length_exceeded/);

    expect(() =>
      codeWorkspaceManifestSchema.parse({
        entries: Array.from({ length: 2001 }, (_, index) => ({
          path: `file-${index}.ts`,
          kind: "file" as const,
          bytes: 1,
          contentHash: `sha256:${index}`,
        })),
      }),
    ).toThrow();
  });

  it("describes reviewable patches, immutable snapshots, and package results", () => {
    const patch = codeWorkspacePatchSchema.parse({
      requestId: "00000000-0000-4000-8000-000000000102",
      codeWorkspaceId: "00000000-0000-4000-8000-000000000103",
      baseSnapshotId,
      operations: [
        {
          op: "update",
          path: "src/App.tsx",
          beforeHash: "sha256:old",
          afterHash: "sha256:new",
          inlineContent: "export const App = () => null;",
        },
        {
          op: "rename",
          path: "src/App.tsx",
          newPath: "src/Main.tsx",
          beforeHash: "sha256:new",
          afterHash: "sha256:new",
        },
      ],
      preview: {
        filesChanged: 1,
        additions: 3,
        deletions: 1,
        summary: "Update and rename app entry",
      },
      risk: "write",
    });
    expect(patch.operations[1].newPath).toBe("src/Main.tsx");

    const snapshot = codeWorkspaceSnapshotSchema.parse({
      id: baseSnapshotId,
      parentSnapshotId: null,
      treeHash: "sha256:tree",
      manifest: { entries: [{ path: "src", kind: "directory" }] },
    });
    expect(snapshot.manifest.entries[0].kind).toBe("directory");

    const packaged = codeWorkspacePackageResultSchema.parse({
      ok: true,
      snapshotId: baseSnapshotId,
      objectKey: "code-workspaces/demo/snapshot.zip",
      filename: "demo.zip",
      bytes: 4096,
    });
    expect(packaged.ok).toBe(true);
  });

  it("allows only approved code workspace command runs", () => {
    const parsed = codeWorkspaceCommandRunRequestSchema.parse({
      requestId: "00000000-0000-4000-8000-000000000202",
      codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
      snapshotId: baseSnapshotId,
      command: "test",
      timeoutMs: 30_000,
    });
    expect(parsed.command).toBe("test");

    expect(() =>
      codeWorkspaceCommandRunRequestSchema.parse({
        codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
        snapshotId: baseSnapshotId,
        command: "rm -rf /",
      }),
    ).toThrow();

    expect(() =>
      codeWorkspaceCommandRunRequestSchema.parse({
        workspaceId: "00000000-0000-4000-8000-000000000999",
        codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
        snapshotId: baseSnapshotId,
        command: "lint",
      }),
    ).toThrow(/scope_fields_are_server_injected/);
  });
});
