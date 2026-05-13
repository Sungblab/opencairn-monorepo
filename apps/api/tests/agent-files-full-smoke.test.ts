import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  agentFiles,
  chatMessages,
  db,
  eq,
  synthesisDocuments,
  synthesisRuns,
} from "@opencairn/db";
import type { AgentChunk } from "../src/lib/agent-pipeline.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const realStorageSmokeEnabled = process.env.AGENT_FILES_REAL_STORAGE_SMOKE === "1";

describe.skipIf(!realStorageSmokeEnabled)(
  "agent files full API smoke with real DB and object storage",
  () => {
    let app: Awaited<ReturnType<typeof import("../src/app.js").createApp>>;
    let setRunAgentForTest: typeof import("../src/routes/threads.js").__setRunAgentForTest;
    let ensureBucket: typeof import("../src/lib/s3.js").ensureBucket;
    let uploadObject: typeof import("../src/lib/s3.js").uploadObject;
    let getS3Client: typeof import("../src/lib/s3.js").getS3Client;
    let getBucket: typeof import("../src/lib/s3.js").getBucket;
    const cleanups: SeedResult[] = [];

    beforeAll(async () => {
      process.env.FEATURE_SYNTHESIS_EXPORT = "true";
      ({ ensureBucket, uploadObject, getS3Client, getBucket } = await import("../src/lib/s3.js"));
      await ensureBucket();
      ({ __setRunAgentForTest: setRunAgentForTest } = await import("../src/routes/threads.js"));
      const { createApp } = await import("../src/app.js");
      app = createApp();
    });

    afterEach(async () => {
      setRunAgentForTest?.(null);
      for (const seed of cleanups.splice(0)) await seed.cleanup();
    });

    async function authedRequest(
      path: string,
      init: RequestInit & { userId: string },
    ): Promise<Response> {
      const { userId, headers, ...rest } = init;
      const cookie = await signSessionCookie(userId);
      return app.request(path, {
        ...rest,
        headers: {
          ...(headers ?? {}),
          cookie,
          "content-type": "application/json",
        },
      });
    }

    async function createThread(workspaceId: string, userId: string): Promise<string> {
      const res = await authedRequest("/api/threads", {
        method: "POST",
        userId,
        body: JSON.stringify({ workspace_id: workspaceId, title: "agent file smoke" }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    }

    function parseSseEvents(text: string): Array<{ event: string; data: unknown }> {
      return text
        .split("\n\n")
        .filter((block) => block.trim().length > 0)
        .map((block) => {
          const event = block.match(/^event: (.+)$/m)?.[1] ?? "";
          const dataStr = block.match(/^data: (.+)$/m)?.[1] ?? "null";
          return { event, data: JSON.parse(dataStr) };
        });
    }

    it("creates, reads, downloads, versions, and lists agent files from a thread-backed project object", async () => {
      const seed = await seedWorkspace({ role: "owner" });
      cleanups.push(seed);
      const threadId = await createThread(seed.workspaceId, seed.userId);
      const originalContent = "# Real storage smoke\n\nThis was written through the thread API.";
      const versionContent = "# Real storage smoke v2\n\nUpdated through the versions API.";

      async function* fakeAgentFileStream(): AsyncGenerator<AgentChunk> {
        yield {
          type: "agent_file",
          payload: {
            files: [
              {
                filename: "real-storage-smoke.md",
                title: "Real Storage Smoke",
                kind: "markdown",
                mimeType: "text/markdown",
                content: originalContent,
                startIngest: false,
              },
            ],
          },
        };
        yield { type: "text", payload: { delta: "Created real storage smoke." } };
        yield { type: "done", payload: {} };
      }
      setRunAgentForTest(fakeAgentFileStream);

      const send = await authedRequest(`/api/threads/${threadId}/messages`, {
        method: "POST",
        userId: seed.userId,
        body: JSON.stringify({
          content: "create a real file",
          mode: "auto",
          scope: {
            projectId: seed.projectId,
            manifest: { actionApprovalMode: "auto_safe" },
          },
        }),
      });
      expect(send.status).toBe(200);
      const events = parseSseEvents(await send.text());
      const typed = events.find((event) => event.event === "project_object_created");
      const legacy = events.find((event) => event.event === "agent_file_created");
      expect(typed, "project_object_created event not found in SSE stream").toBeDefined();
      expect(legacy, "agent_file_created event not found in SSE stream").toBeDefined();
      expect(typed?.data).toMatchObject({
        type: "project_object_created",
        object: {
          objectType: "agent_file",
          filename: "real-storage-smoke.md",
          projectId: seed.projectId,
        },
      });
      expect(legacy?.data).toMatchObject({
        type: "agent_file_created",
        file: {
          filename: "real-storage-smoke.md",
          source: "agent_chat",
          ingestStatus: "not_started",
        },
      });

      const fileId = (typed!.data as { object: { id: string } }).object.id;
      const [row] = await db.select().from(agentFiles).where(eq(agentFiles.id, fileId));
      expect(row).toMatchObject({
        id: fileId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        chatThreadId: threadId,
        source: "agent_chat",
        ingestStatus: "not_started",
        bytes: Buffer.byteLength(originalContent),
      });
      expect(row!.objectKey).toContain(`/v1/real-storage-smoke.md`);

      const [message] = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, row!.chatMessageId!));
      expect(message!.content).toMatchObject({
        agent_files: [{ id: fileId }],
        project_objects: [{ id: fileId, objectType: "agent_file" }],
      });

      const meta = await authedRequest(`/api/agent-files/${fileId}`, {
        method: "GET",
        userId: seed.userId,
      });
      expect(meta.status).toBe(200);
      expect(await meta.json()).toMatchObject({
        file: {
          id: fileId,
          filename: "real-storage-smoke.md",
          bytes: Buffer.byteLength(originalContent),
        },
      });

      const download = await authedRequest(`/api/agent-files/${fileId}/file`, {
        method: "GET",
        userId: seed.userId,
      });
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toBe("text/markdown");
      expect(await download.text()).toBe(originalContent);

      const tree = await authedRequest(`/api/projects/${seed.projectId}/tree`, {
        method: "GET",
        userId: seed.userId,
      });
      expect(tree.status).toBe(200);
      const treeBody = (await tree.json()) as {
        nodes: Array<{ kind: string; id: string; label: string; file_kind: string | null }>;
      };
      expect(treeBody.nodes).toContainEqual(
        expect.objectContaining({
          kind: "agent_file",
          id: fileId,
          label: "Real Storage Smoke",
          file_kind: "markdown",
        }),
      );

      const version = await authedRequest(`/api/agent-files/${fileId}/versions`, {
        method: "POST",
        userId: seed.userId,
        body: JSON.stringify({
          content: versionContent,
          startIngest: false,
        }),
      });
      expect(version.status).toBe(201);
      const versionFile = ((await version.json()) as { file: { id: string; version: number } }).file;
      expect(versionFile.version).toBe(2);

      const versionDownload = await authedRequest(`/api/agent-files/${versionFile.id}/file`, {
        method: "GET",
        userId: seed.userId,
      });
      expect(versionDownload.status).toBe(200);
      expect(await versionDownload.text()).toBe(versionContent);
    });

    it("publishes a completed synthesis document as an agent file and streams its existing object", async () => {
      const seed = await seedWorkspace({ role: "owner" });
      cleanups.push(seed);
      const runId = randomUUID();
      const objectKey = `synthesis/runs/${runId}/document.md`;
      const bodyBytes = Buffer.from("# Synthesis publish smoke\n\nStored before publish.", "utf8");
      try {
        await uploadObject(objectKey, bodyBytes, "text/markdown");
        await db.insert(synthesisRuns).values({
          id: runId,
          workspaceId: seed.workspaceId,
          userId: seed.userId,
          projectId: seed.projectId,
          status: "completed",
          format: "md",
          template: "report",
          userPrompt: "publish me",
          autoSearch: false,
        });
        await db.insert(synthesisDocuments).values({
          runId,
          format: "md",
          s3Key: objectKey,
          bytes: bodyBytes.length,
        });

        const publish = await authedRequest(`/api/synthesis-export/runs/${runId}/project-object`, {
          method: "POST",
          userId: seed.userId,
          body: JSON.stringify({ format: "md" }),
        });
        expect(publish.status).toBe(201);
        const published = (await publish.json()) as {
          event: { type: string; object: { id: string; objectType: string } };
          compatibilityEvent: { type: string; file: { id: string } };
          file: { id: string; source: string };
        };
        expect(published.event).toMatchObject({
          type: "project_object_created",
          object: { objectType: "agent_file" },
        });
        expect(published.compatibilityEvent).toMatchObject({
          type: "agent_file_created",
          file: { id: published.file.id },
        });
        expect(published.file.source).toBe("synthesis_export");

        const [row] = await db
          .select()
          .from(agentFiles)
          .where(eq(agentFiles.id, published.file.id));
        expect(row!.objectKey).toBe(objectKey);

        const download = await authedRequest(`/api/agent-files/${published.file.id}/file`, {
          method: "GET",
          userId: seed.userId,
        });
        expect(download.status).toBe(200);
        expect(await download.text()).toBe(bodyBytes.toString("utf8"));
      } finally {
        await getS3Client().removeObject(getBucket(), objectKey).catch(() => undefined);
      }
    });
  },
);
