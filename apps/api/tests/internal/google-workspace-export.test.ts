import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  agentActions,
  agentFiles,
  agentFileProviderExports,
  db,
  eq,
} from "@opencairn/db";

const SECRET = "test-internal-secret-google-export";
process.env.INTERNAL_API_SECRET = SECRET;

import { createApp } from "../../src/app.js";
import { seedWorkspace, type SeedResult } from "../helpers/seed.js";

const app = createApp();
const headers = {
  "X-Internal-Secret": SECRET,
  "Content-Type": "application/json",
};

describe("/api/internal/google-workspace/export-results", () => {
  let seed: SeedResult;
  let fileId: string;
  let actionId: string;
  let requestId: string;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
    requestId = randomUUID();
    fileId = randomUUID();
    actionId = randomUUID();
    await db.insert(agentFiles).values({
      id: fileId,
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      createdBy: seed.userId,
      title: "Report",
      filename: "report.docx",
      extension: "docx",
      kind: "docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      objectKey: `agent-files/${fileId}/report.docx`,
      bytes: 4096,
      contentHash: "sha256:test",
      versionGroupId: randomUUID(),
    });
    await db.insert(agentActions).values({
      id: actionId,
      requestId,
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      actorUserId: seed.userId,
      kind: "file.export",
      status: "queued",
      risk: "external",
      input: {
        type: "export_project_object",
        objectId: fileId,
        provider: "google_docs",
      },
      result: {
        workflowId: `google-workspace-export/${requestId}`,
        workflowHint: "google_workspace_export",
      },
    });
  });

  afterEach(async () => {
    if (seed) await seed.cleanup();
  });

  it("finalizes a completed export and persists the external provider link", async () => {
    const res = await app.request("/api/internal/google-workspace/export-results", {
      method: "POST",
      headers,
      body: JSON.stringify({
        actionId,
        requestId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        userId: seed.userId,
        ok: true,
        workflowId: `google-workspace-export/${requestId}`,
        objectId: fileId,
        provider: "google_docs",
        externalObjectId: "google-doc-1",
        externalUrl: "https://docs.google.com/document/d/google-doc-1/edit",
        exportedMimeType: "application/vnd.google-apps.document",
        exportStatus: "completed",
      }),
    });

    expect(res.status).toBe(200);
    const [action] = await db
      .select()
      .from(agentActions)
      .where(eq(agentActions.id, actionId));
    expect(action!.status).toBe("completed");
    expect(action!.result).toMatchObject({
      ok: true,
      externalObjectId: "google-doc-1",
      externalUrl: "https://docs.google.com/document/d/google-doc-1/edit",
    });
    const [record] = await db
      .select()
      .from(agentFileProviderExports)
      .where(eq(agentFileProviderExports.actionId, actionId));
    expect(record).toMatchObject({
      agentFileId: fileId,
      provider: "google_docs",
      status: "completed",
      externalObjectId: "google-doc-1",
      externalUrl: "https://docs.google.com/document/d/google-doc-1/edit",
      exportedMimeType: "application/vnd.google-apps.document",
    });
  });

  it("finalizes failed exports as retryable action errors", async () => {
    const res = await app.request("/api/internal/google-workspace/export-results", {
      method: "POST",
      headers,
      body: JSON.stringify({
        actionId,
        requestId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        userId: seed.userId,
        ok: false,
        workflowId: `google-workspace-export/${requestId}`,
        objectId: fileId,
        provider: "google_docs",
        exportStatus: "failed",
        errorCode: "google_export_live_disabled",
        retryable: true,
      }),
    });

    expect(res.status).toBe(200);
    const [action] = await db
      .select()
      .from(agentActions)
      .where(eq(agentActions.id, actionId));
    expect(action).toMatchObject({
      status: "failed",
      errorCode: "google_export_live_disabled",
    });
    const [record] = await db
      .select()
      .from(agentFileProviderExports)
      .where(eq(agentFileProviderExports.actionId, actionId));
    expect(record).toMatchObject({
      status: "failed",
      errorCode: "google_export_live_disabled",
      retryable: true,
    });
  });

  it("rejects mismatched action scope", async () => {
    const res = await app.request("/api/internal/google-workspace/export-results", {
      method: "POST",
      headers,
      body: JSON.stringify({
        actionId,
        requestId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        userId: seed.userId,
        ok: false,
        workflowId: `google-workspace-export/${requestId}`,
        objectId: randomUUID(),
        provider: "google_docs",
        exportStatus: "failed",
        errorCode: "google_workspace_export_failed",
        retryable: true,
      }),
    });

    expect(res.status).toBe(409);
  });
});
