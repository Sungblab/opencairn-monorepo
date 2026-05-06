import { describe, expect, it } from "vitest";
import {
  codeWorkspaceCreateRequestSchema,
  codeWorkspaceCommandRunRequestSchema,
  codeWorkspaceCommandRunResultSchema,
  codeWorkspaceInstallRequestSchema,
  codeWorkspaceManifestSchema,
  codeWorkspacePatchSchema,
  codeWorkspacePreviewResultSchema,
  codeWorkspacePreviewRequestSchema,
  codeWorkspacePreviewSmokeResultSchema,
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
    expect(() => normalizeCodeWorkspacePath("C:temp/file.txt")).toThrow(/path_must_not_include_drive_letter/);

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

    expect(() =>
      codeWorkspaceCommandRunRequestSchema.parse({
        codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
        snapshotId: baseSnapshotId,
        command: "build",
        network: "enabled",
      }),
    ).toThrow(/unrecognized_key/);

    const result = codeWorkspaceCommandRunResultSchema.parse({
      ok: false,
      codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
      snapshotId: baseSnapshotId,
      command: "test",
      exitCode: 1,
      logs: [{ stream: "stderr", text: "tests failed" }],
      archiveUrl: "/api/code-workspaces/00000000-0000-4000-8000-000000000203/snapshots/00000000-0000-4000-8000-000000000101/archive",
    });
    expect(result.archiveUrl).toContain("/archive");
  });

  it("requires explicit network approval details for dependency installs", () => {
    const parsed = codeWorkspaceInstallRequestSchema.parse({
      codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
      snapshotId: baseSnapshotId,
      packageManager: "pnpm",
      packages: [{ name: "@vitejs/plugin-react", dev: true }],
      network: "required",
      reason: "Install Vite React plugin before build",
    });

    expect(parsed).toMatchObject({
      packageManager: "pnpm",
      network: "required",
      packages: [{ name: "@vitejs/plugin-react", dev: true }],
    });

    expect(() =>
      codeWorkspaceInstallRequestSchema.parse({
        workspaceId: "00000000-0000-4000-8000-000000000999",
        codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
        snapshotId: baseSnapshotId,
        packages: [{ name: "lodash" }],
        network: "required",
      }),
    ).toThrow(/scope_fields_are_server_injected/);

    expect(() =>
      codeWorkspaceInstallRequestSchema.parse({
        codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
        snapshotId: baseSnapshotId,
        packages: [{ name: "lodash" }],
      }),
    ).toThrow();
  });

  it("describes static hosted preview requests without starting a server", () => {
    const parsed = codeWorkspacePreviewRequestSchema.parse({
      codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
      snapshotId: baseSnapshotId,
      mode: "static",
      entryPath: "index.html",
      reason: "Review the generated app",
    });

    expect(parsed).toMatchObject({
      mode: "static",
      entryPath: "index.html",
    });

    expect(() =>
      codeWorkspacePreviewRequestSchema.parse({
        codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
        snapshotId: baseSnapshotId,
        mode: "vite",
      }),
    ).toThrow();
  });

  it("allows static preview results to include opt-in signed public URLs", () => {
    const parsed = codeWorkspacePreviewResultSchema.parse({
      ok: true,
      kind: "code_project.preview",
      mode: "static",
      codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
      snapshotId: baseSnapshotId,
      entryPath: "index.html",
      previewUrl:
        "/api/agent-actions/00000000-0000-4000-8000-000000000204/preview/index.html",
      assetsBaseUrl: "/api/agent-actions/00000000-0000-4000-8000-000000000204/preview/",
      publicPreviewUrl:
        "https://preview.example.com/api/public/agent-actions/00000000-0000-4000-8000-000000000204/preview/token/index.html",
      publicAssetsBaseUrl:
        "https://preview.example.com/api/public/agent-actions/00000000-0000-4000-8000-000000000204/preview/token/",
      expiresAt: "2026-05-06T00:00:00.000Z",
    });

    expect(parsed.publicPreviewUrl).toContain("/api/public/agent-actions/");
    expect(parsed.publicAssetsBaseUrl).toContain("/preview/token/");
  });

  it("allows static preview results to carry browser smoke evidence", () => {
    const smoke = codeWorkspacePreviewSmokeResultSchema.parse({
      ok: true,
      status: 200,
      url: "https://preview.example.com/index.html",
      bodyChars: 42,
      screenshotPath: "output/playwright/preview.png",
      checkedAt: "2026-05-06T00:01:00.000Z",
    });
    const parsed = codeWorkspacePreviewResultSchema.parse({
      ok: true,
      kind: "code_project.preview",
      mode: "static",
      codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
      snapshotId: baseSnapshotId,
      entryPath: "index.html",
      previewUrl:
        "/api/agent-actions/00000000-0000-4000-8000-000000000204/preview/index.html",
      assetsBaseUrl: "/api/agent-actions/00000000-0000-4000-8000-000000000204/preview/",
      expiresAt: "2026-05-06T00:00:00.000Z",
      browserSmoke: smoke,
    });

    expect(parsed.browserSmoke?.screenshotPath).toBe("output/playwright/preview.png");
  });
});
