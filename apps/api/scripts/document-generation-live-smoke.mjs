#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Client as MinioClient } from "minio";
import {
  agentActions,
  agentFiles,
  chatMessages,
  chatThreads,
  db,
  eq,
  notes,
  researchRunArtifacts,
  researchRuns,
  synthesisDocuments,
  synthesisRuns,
} from "@opencairn/db";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:4000";
const INTERNAL_API_SECRET = requiredEnv("INTERNAL_API_SECRET");
const S3_BUCKET = process.env.S3_BUCKET ?? "opencairn-uploads";
const POLL_TIMEOUT_MS = Number(process.env.DOC_GEN_SMOKE_TIMEOUT_MS ?? 120_000);
const POLL_INTERVAL_MS = 1_000;
const URL_ENV_NAMES = [
  "API_BASE_URL",
  "INTERNAL_API_URL",
  "DATABASE_URL",
  "REDIS_URL",
  "TEMPORAL_ADDRESS",
  "S3_ENDPOINT",
];

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseHttpUrl(name, value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`expected http or https URL, got ${url.protocol}`);
    }
    return url;
  } catch (error) {
    throw new Error(
      `${name} must be a valid http(s) URL: ${value} (${error.message})`,
    );
  }
}

function looksLikeTruncatedScheme(value) {
  return /^(ttp|ttps):\/\//i.test(value);
}

function validateUrlEnv(name, value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (looksLikeTruncatedScheme(trimmed)) {
    throw new Error(
      `${name} looks like a truncated URL scheme (${trimmed}). ` +
        "PowerShell .env parsers that trim or split incorrectly can corrupt values; " +
        "reload the root .env with the documented parser and override this variable explicitly.",
    );
  }
  if (name === "API_BASE_URL" || name === "INTERNAL_API_URL") {
    parseHttpUrl(name, trimmed);
  }
  return trimmed;
}

function smokePreflight() {
  parseHttpUrl("API_BASE_URL", API_BASE_URL);
  if (!Number.isFinite(POLL_TIMEOUT_MS) || POLL_TIMEOUT_MS <= 0) {
    throw new Error(
      `DOC_GEN_SMOKE_TIMEOUT_MS must be a positive number, got ${POLL_TIMEOUT_MS}`,
    );
  }
  const env = Object.fromEntries(
    URL_ENV_NAMES.map((name) => [
      name,
      validateUrlEnv(name, process.env[name]),
    ]).filter(([, value]) => value),
  );
  return {
    apiBaseUrl: API_BASE_URL,
    smokeOrigin: process.env.SMOKE_ORIGIN ?? "http://localhost:3000",
    timeoutMs: POLL_TIMEOUT_MS,
    workerInternalApiUrl:
      process.env.INTERNAL_API_URL ??
      `${API_BASE_URL} (recommended worker override; set INTERNAL_API_URL explicitly when starting the worker)`,
    env,
  };
}

function parseS3Endpoint() {
  let endpoint = process.env.S3_ENDPOINT ?? "localhost:9000";
  let useSSL = process.env.S3_USE_SSL === "true";
  if (endpoint.startsWith("https://")) {
    endpoint = endpoint.slice("https://".length);
    useSSL = true;
  } else if (endpoint.startsWith("http://")) {
    endpoint = endpoint.slice("http://".length);
    useSSL = false;
  }
  endpoint = endpoint.split("/")[0];
  const [endPoint, rawPort] = endpoint.split(":");
  return {
    endPoint: endPoint || "localhost",
    port: Number(rawPort ?? (useSSL ? 443 : 9000)),
    useSSL,
  };
}

function expectedMagic(format) {
  if (format === "pdf") return ["25504446"];
  if (["docx", "pptx", "xlsx"].includes(format)) {
    return ["504b0304", "504b0506", "504b0708"];
  }
  return [];
}

async function qaDownloadedArtifact({ scenario, artifact, file, download }) {
  const contentType = download.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await download.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const magicHex = buffer.subarray(0, 4).toString("hex");
  const magicCandidates = expectedMagic(scenario.format);
  const magicOk =
    magicCandidates.length === 0 ||
    magicCandidates.some((magic) => magicHex.startsWith(magic));
  const objectBytes = Number(artifact.bytes ?? 0);
  const rowBytes = Number(file.bytes ?? 0);
  if (buffer.length === 0) {
    throw new Error(`${scenario.name} downloaded artifact is empty`);
  }
  if (objectBytes > 0 && buffer.length !== objectBytes) {
    throw new Error(
      `${scenario.name} byte mismatch: downloaded=${buffer.length}, artifact=${objectBytes}`,
    );
  }
  if (rowBytes > 0 && buffer.length !== rowBytes) {
    throw new Error(
      `${scenario.name} byte mismatch: downloaded=${buffer.length}, row=${rowBytes}`,
    );
  }
  if (!magicOk) {
    throw new Error(
      `${scenario.name} magic mismatch for ${scenario.format}: ${magicHex}, expected one of ${magicCandidates.join(", ")}`,
    );
  }
  return {
    contentType,
    downloadedBytes: buffer.length,
    artifactBytes: objectBytes || null,
    agentFileBytes: rowBytes || null,
    sha256,
    magicHex,
    magicOk,
  };
}

function s3Client() {
  return new MinioClient({
    ...parseS3Endpoint(),
    accessKey: requiredEnv("S3_ACCESS_KEY"),
    secretKey: requiredEnv("S3_SECRET_KEY"),
  });
}

async function ensureBucket(client) {
  if (!(await client.bucketExists(S3_BUCKET))) {
    await client.makeBucket(S3_BUCKET, "us-east-1");
  }
}

async function putTextObject(client, key, body, contentType = "text/markdown") {
  const buffer = Buffer.from(body, "utf8");
  await client.putObject(S3_BUCKET, key, Readable.from(buffer), buffer.length, {
    "Content-Type": contentType,
  });
  return buffer.length;
}

async function api(path, init = {}) {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? {});
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    !headers.has("origin")
  ) {
    headers.set("origin", process.env.SMOKE_ORIGIN ?? "http://localhost:3000");
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path} -> ${response.status}: ${text}`,
    );
  }
  return body;
}

async function seedBase() {
  const seed = await api("/api/internal/test-seed", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": INTERNAL_API_SECRET,
    },
    body: JSON.stringify({}),
  });
  await db
    .update(notes)
    .set({
      title: "Document generation live smoke note",
      contentText:
        "OpenCairn live smoke note source. 한국어 본문과 English context should survive hydration.",
    })
    .where(eq(notes.id, seed.noteId));
  return seed;
}

async function createAgentFile(seed) {
  const id = randomUUID();
  const versionGroupId = randomUUID();
  const filename = "doc-gen-live-agent-source.md";
  const body =
    "# Agent file source\n\nThis markdown file was created as source seed for live smoke.";
  const buffer = Buffer.from(body, "utf8");
  const objectKey = `agent-files/${seed.workspaceId}/${seed.projectId}/${id}/v1/${encodeURIComponent(filename)}`;
  await putTextObject(
    s3Client(),
    objectKey,
    body,
    "text/markdown; charset=utf-8",
  );
  await db.insert(agentFiles).values({
    id,
    workspaceId: seed.workspaceId,
    projectId: seed.projectId,
    createdBy: seed.userId,
    title: "Doc Gen Live Agent Source",
    filename,
    extension: "md",
    kind: "markdown",
    mimeType: "text/markdown; charset=utf-8",
    objectKey,
    bytes: buffer.length,
    contentHash: createHash("sha256").update(buffer).digest("hex"),
    source: "manual",
    versionGroupId,
    version: 1,
    ingestStatus: "not_started",
  });
  return id;
}

async function createChatThread(seed) {
  const [thread] = await db
    .insert(chatThreads)
    .values({
      workspaceId: seed.workspaceId,
      userId: seed.userId,
      title: "Document generation live smoke chat",
    })
    .returning({ id: chatThreads.id });
  await db.insert(chatMessages).values([
    {
      threadId: thread.id,
      role: "user",
      content: {
        text: "Summarize the source material into an executive brief.",
      },
    },
    {
      threadId: thread.id,
      role: "agent",
      content: {
        text: "The material discusses source hydration and generated artifacts.",
      },
    },
  ]);
  return thread.id;
}

async function createResearchRun(seed) {
  const id = randomUUID();
  await db.insert(researchRuns).values({
    id,
    workspaceId: seed.workspaceId,
    projectId: seed.projectId,
    userId: seed.userId,
    topic: "Document generation live smoke research",
    model: "deep-research-preview-04-2026",
    billingPath: "byok",
    status: "completed",
    workflowId: id,
  });
  await db.insert(researchRunArtifacts).values({
    runId: id,
    seq: 0,
    kind: "text_delta",
    payload: {
      text: "Research artifact text for document generation live smoke.",
    },
  });
  return id;
}

async function createSynthesisRun(seed, client) {
  const runId = randomUUID();
  const objectKey = `synthesis/runs/${runId}/document.md`;
  const bytes = await putTextObject(
    client,
    objectKey,
    "# Synthesis smoke document\n\nSynthesis document body used as a hydrated source.",
  );
  await db.insert(synthesisRuns).values({
    id: runId,
    workspaceId: seed.workspaceId,
    projectId: seed.projectId,
    userId: seed.userId,
    format: "md",
    template: "report",
    userPrompt: "Create a concise synthesis document.",
    autoSearch: false,
    status: "completed",
    workflowId: runId,
    tokensUsed: 12,
  });
  const [document] = await db
    .insert(synthesisDocuments)
    .values({
      runId,
      format: "md",
      s3Key: objectKey,
      bytes,
    })
    .returning({ id: synthesisDocuments.id });
  return { runId, documentId: document.id };
}

async function waitForAction(actionId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last;
  while (Date.now() < deadline) {
    const [action] = await db
      .select()
      .from(agentActions)
      .where(eq(agentActions.id, actionId))
      .limit(1);
    last = action;
    if (action?.status === "completed") return action;
    if (action?.status === "failed" || action?.status === "cancelled") {
      throw new Error(
        `action ${actionId} ended as ${action.status}: ${JSON.stringify(action.result)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `action ${actionId} did not complete before timeout; last=${JSON.stringify(last)}`,
  );
}

async function runScenario(seed, client, scenario) {
  const requestId = randomUUID();
  const response = await api(
    `/api/projects/${seed.projectId}/project-object-actions/generate`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${seed.cookieName}=${seed.cookieValue}`,
      },
      body: JSON.stringify({
        type: "generate_project_object",
        requestId,
        generation: {
          format: scenario.format,
          prompt: `Generate ${scenario.name} live smoke artifact.`,
          locale: "ko",
          template: scenario.template,
          sources: [scenario.source],
          destination: {
            filename: `doc-gen-live-${scenario.name}.${scenario.format}`,
            title: `Doc Gen Live ${scenario.name}`,
            publishAs: "agent_file",
            startIngest: false,
          },
          artifactMode: "object_storage",
        },
      }),
    },
  );
  const action = await waitForAction(response.action.id);
  const object = action.result?.object;
  const artifact = action.result?.artifact;
  if (!object?.id || !artifact?.objectKey) {
    throw new Error(
      `completed action missing object/artifact: ${JSON.stringify(action.result)}`,
    );
  }
  const [file] = await db
    .select()
    .from(agentFiles)
    .where(eq(agentFiles.id, object.id))
    .limit(1);
  if (!file) throw new Error(`agent_files row missing for ${object.id}`);
  if (file.source !== "document_generation") {
    throw new Error(`agent_files source mismatch: ${file.source}`);
  }
  const objectStat = await client.statObject(S3_BUCKET, artifact.objectKey);
  const download = await fetch(
    `${API_BASE_URL}/api/agent-files/${object.id}/file`,
    {
      headers: { cookie: `${seed.cookieName}=${seed.cookieValue}` },
    },
  );
  if (!download.ok) {
    throw new Error(
      `download ${object.id} failed: ${download.status} ${await download.text()}`,
    );
  }
  const artifactQa = await qaDownloadedArtifact({
    scenario,
    artifact,
    file,
    download,
  });
  return {
    name: scenario.name,
    sourceType: scenario.source.type,
    format: scenario.format,
    requestId,
    workflowId: response.workflowId,
    actionId: action.id,
    agentFileId: object.id,
    objectKey: artifact.objectKey,
    bytes: artifact.bytes,
    objectStorageBytes: objectStat.size,
    downloadStatus: download.status,
    artifactQa,
  };
}

async function verifySourcePicker(seed, expected) {
  const response = await api(
    `/api/projects/${seed.projectId}/document-generation/sources`,
    {
      headers: {
        cookie: `${seed.cookieName}=${seed.cookieValue}`,
      },
    },
  );
  const types = new Set((response.sources ?? []).map((source) => source.type));
  for (const type of expected) {
    if (!types.has(type)) {
      throw new Error(
        `source picker missing ${type}: ${JSON.stringify(response.sources)}`,
      );
    }
  }
  return {
    count: response.sources.length,
    types: [...types].sort(),
  };
}

const preflight = smokePreflight();
console.error(
  JSON.stringify(
    {
      smokePreflight: preflight,
    },
    null,
    2,
  ),
);

const client = s3Client();
await ensureBucket(client);
const seed = await seedBase();
const agentFileId = await createAgentFile(seed);
const threadId = await createChatThread(seed);
const researchRunId = await createResearchRun(seed);
const synthesis = await createSynthesisRun(seed, client);
const sourcePicker = await verifySourcePicker(seed, [
  "note",
  "agent_file",
  "chat_thread",
  "research_run",
  "synthesis_run",
]);

const scenarios = [
  {
    name: "note",
    format: "pdf",
    template: "report",
    source: { type: "note", noteId: seed.noteId },
  },
  {
    name: "agent-file",
    format: "docx",
    template: "brief",
    source: { type: "agent_file", objectId: agentFileId },
  },
  {
    name: "chat-thread",
    format: "pptx",
    template: "deck",
    source: { type: "chat_thread", threadId },
  },
  {
    name: "research-run",
    format: "xlsx",
    template: "spreadsheet",
    source: { type: "research_run", runId: researchRunId },
  },
  {
    name: "synthesis-document",
    format: "pdf",
    template: "research_summary",
    source: {
      type: "synthesis_run",
      runId: synthesis.runId,
      documentId: synthesis.documentId,
    },
  },
];

const results = [];
for (const scenario of scenarios) {
  results.push(await runScenario(seed, client, scenario));
}

console.log(
  JSON.stringify(
    {
      ok: true,
      apiBaseUrl: API_BASE_URL,
      preflight,
      seed: {
        userId: seed.userId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        noteId: seed.noteId,
        agentFileId,
        threadId,
        researchRunId,
        synthesisRunId: synthesis.runId,
        synthesisDocumentId: synthesis.documentId,
      },
      sourcePicker,
      results,
    },
    null,
    2,
  ),
);
