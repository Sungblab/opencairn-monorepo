#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { serializeSigned } from "hono/utils/cookie";
import {
  agentActions,
  agentFileProviderExports,
  and,
  db,
  eq,
  notes,
  projects,
  session as sessionTable,
  userIntegrations,
  workspaceMembers,
} from "@opencairn/db";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:4000";
const POLL_TIMEOUT_MS = Number(
  process.env.GOOGLE_EXPORT_SMOKE_TIMEOUT_MS ??
    process.env.DOC_GEN_SMOKE_TIMEOUT_MS ??
    180_000,
);
const POLL_INTERVAL_MS = 1_000;
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const COOKIE_NAME = "better-auth.session_token";

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

function requiredPositiveTimeout() {
  if (!Number.isFinite(POLL_TIMEOUT_MS) || POLL_TIMEOUT_MS <= 0) {
    throw new Error(
      `GOOGLE_EXPORT_SMOKE_TIMEOUT_MS must be a positive number, got ${POLL_TIMEOUT_MS}`,
    );
  }
  return POLL_TIMEOUT_MS;
}

function smokePreflight() {
  parseHttpUrl("API_BASE_URL", API_BASE_URL);
  return {
    apiBaseUrl: API_BASE_URL,
    smokeOrigin: process.env.SMOKE_ORIGIN ?? "http://localhost:3000",
    timeoutMs: requiredPositiveTimeout(),
    requiredApiWorkerFlags: {
      FEATURE_DOCUMENT_GENERATION: "true",
      FEATURE_GOOGLE_WORKSPACE_EXPORT: "true",
    },
    selectedGrant: {
      userId: process.env.GOOGLE_EXPORT_SMOKE_USER_ID ?? null,
      workspaceId: process.env.GOOGLE_EXPORT_SMOKE_WORKSPACE_ID ?? null,
    },
  };
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
      `${method} ${path} -> ${response.status}: ${text}`,
    );
  }
  return body;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function signSessionForUser(userId) {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(sessionTable).values({
    id,
    token,
    userId,
    expiresAt,
  });
  const setCookie = await serializeSigned(
    COOKIE_NAME,
    token,
    requiredEnv("BETTER_AUTH_SECRET"),
    {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      expires: expiresAt,
    },
  );
  return {
    cookieHeader: setCookie.split(";", 1)[0],
    setCookie,
    expiresAt,
  };
}

function hasDriveFileScope(scopes) {
  return scopes.includes(DRIVE_FILE_SCOPE) || scopes.includes("drive.file");
}

async function findGoogleGrant() {
  const requestedUserId = process.env.GOOGLE_EXPORT_SMOKE_USER_ID;
  const requestedWorkspaceId = process.env.GOOGLE_EXPORT_SMOKE_WORKSPACE_ID;
  const rows = await db
    .select({
      userId: userIntegrations.userId,
      workspaceId: userIntegrations.workspaceId,
      accountEmail: userIntegrations.accountEmail,
      scopes: userIntegrations.scopes,
      updatedAt: userIntegrations.updatedAt,
    })
    .from(userIntegrations)
    .where(eq(userIntegrations.provider, "google_drive"));
  const candidates = rows
    .filter((row) => row.workspaceId)
    .filter((row) => hasDriveFileScope(row.scopes))
    .filter((row) => !requestedUserId || row.userId === requestedUserId)
    .filter((row) => !requestedWorkspaceId || row.workspaceId === requestedWorkspaceId)
    .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
  const grant = candidates[0];
  if (!grant) {
    throw new Error(
      "No usable google_drive grant found. Connect Google Drive first, or set GOOGLE_EXPORT_SMOKE_USER_ID and GOOGLE_EXPORT_SMOKE_WORKSPACE_ID to an existing grant with drive.file.",
    );
  }
  const [userMembership] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, grant.workspaceId),
        eq(workspaceMembers.userId, grant.userId),
      ),
    );
  if (!userMembership) {
    throw new Error(
      `User ${grant.userId} is not a member of workspace ${grant.workspaceId}.`,
    );
  }
  if (!["owner", "admin", "member"].includes(userMembership.role)) {
    throw new Error(
      `User ${grant.userId} has workspace role ${userMembership.role}; smoke requires owner, admin, or member so the generated project is writable.`,
    );
  }
  return {
    userId: grant.userId,
    workspaceId: grant.workspaceId,
    accountEmail: grant.accountEmail,
    scopes: grant.scopes,
    workspaceRole: userMembership.role,
  };
}

async function createSmokeProject(grant) {
  const projectName = `Google export live smoke ${new Date().toISOString()}`;
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: grant.workspaceId,
      name: projectName,
      description: "Temporary project created by google-workspace-export-live-smoke.",
      createdBy: grant.userId,
      defaultRole: "editor",
    })
    .returning({ id: projects.id });
  const [note] = await db
    .insert(notes)
    .values({
      workspaceId: grant.workspaceId,
      projectId: project.id,
      title: "Google Workspace export live smoke source",
      contentText:
        "OpenCairn Google Workspace export live smoke source. 한국어 본문과 English context should survive document generation before export.",
      content: [
        {
          type: "p",
          children: [
            {
              text: "OpenCairn Google Workspace export live smoke source.",
            },
          ],
        },
      ],
      sourceType: "manual",
    })
    .returning({ id: notes.id });
  return { projectId: project.id, noteId: note.id };
}

async function waitForAction(actionId, label) {
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
        `${label} action ${actionId} ended as ${action.status}: ${JSON.stringify(action.result)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `${label} action ${actionId} did not complete before timeout; last=${JSON.stringify(last)}`,
  );
}

async function generateAgentFile(seed, cookieHeader, scenario) {
  const requestId = randomUUID();
  const response = await api(
    `/api/projects/${seed.projectId}/project-object-actions/generate`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
      },
      body: JSON.stringify({
        type: "generate_project_object",
        requestId,
        generation: {
          format: scenario.format,
          prompt: `Generate a ${scenario.name} artifact for Google Workspace export live smoke.`,
          locale: "ko",
          template: scenario.template,
          sources: [{ type: "note", noteId: seed.noteId }],
          destination: {
            filename: `google-export-live-${scenario.name}.${scenario.format}`,
            title: `Google Export Live ${scenario.name}`,
            publishAs: "agent_file",
            startIngest: false,
          },
          artifactMode: "object_storage",
        },
      }),
    },
  );
  const action = await waitForAction(response.action.id, `${scenario.name} generation`);
  const object = action.result?.object;
  const artifact = action.result?.artifact;
  if (!object?.id || !artifact?.objectKey) {
    throw new Error(
      `${scenario.name} generation completed without object/artifact: ${JSON.stringify(action.result)}`,
    );
  }
  return {
    requestId,
    workflowId: response.workflowId,
    actionId: action.id,
    agentFileId: object.id,
    filename: object.filename,
    kind: object.kind,
    mimeType: object.mimeType,
    objectKey: artifact.objectKey,
    bytes: artifact.bytes,
  };
}

function expectedExportedMimeType(provider) {
  if (provider === "google_docs") return "application/vnd.google-apps.document";
  if (provider === "google_sheets") return "application/vnd.google-apps.spreadsheet";
  if (provider === "google_slides") return "application/vnd.google-apps.presentation";
  return null;
}

async function verifyProviderExport(action, scenario) {
  const result = action.result;
  if (!result?.ok) {
    throw new Error(`${scenario.name} export did not return ok result: ${JSON.stringify(result)}`);
  }
  if (result.provider !== scenario.provider) {
    throw new Error(`${scenario.name} provider mismatch: ${result.provider}`);
  }
  if (result.objectId !== scenario.generated.agentFileId) {
    throw new Error(`${scenario.name} object mismatch: ${result.objectId}`);
  }
  if (!result.externalObjectId || !result.externalUrl) {
    throw new Error(`${scenario.name} export missing external identifiers`);
  }
  const expectedMime = expectedExportedMimeType(scenario.provider);
  if (expectedMime && result.exportedMimeType !== expectedMime) {
    throw new Error(
      `${scenario.name} exported MIME mismatch: ${result.exportedMimeType}, expected ${expectedMime}`,
    );
  }
  const [row] = await db
    .select()
    .from(agentFileProviderExports)
    .where(eq(agentFileProviderExports.actionId, action.id))
    .limit(1);
  if (!row) throw new Error(`${scenario.name} provider export row missing`);
  if (row.status !== "completed") {
    throw new Error(`${scenario.name} provider export row status mismatch: ${row.status}`);
  }
  if (row.externalObjectId !== result.externalObjectId || row.externalUrl !== result.externalUrl) {
    throw new Error(`${scenario.name} provider export row external metadata mismatch`);
  }
  return {
    actionId: action.id,
    workflowId: result.workflowId,
    provider: result.provider,
    externalObjectId: result.externalObjectId,
    externalUrl: result.externalUrl,
    exportedMimeType: result.exportedMimeType,
    exportRowId: row.id,
  };
}

async function exportAgentFile(seed, cookieHeader, scenario) {
  const requestId = randomUUID();
  const response = await api(
    `/api/projects/${seed.projectId}/project-object-actions/export`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
      },
      body: JSON.stringify({
        type: "export_project_object",
        requestId,
        objectId: scenario.generated.agentFileId,
        format: scenario.format,
        provider: scenario.provider,
      }),
    },
  );
  const action = await waitForAction(response.action.id, `${scenario.name} export`);
  return verifyProviderExport(action, scenario);
}

const preflight = smokePreflight();
console.error(JSON.stringify({ smokePreflight: preflight }, null, 2));

const grant = await findGoogleGrant();
const session = await signSessionForUser(grant.userId);
const seed = await createSmokeProject(grant);
const cookieHeader = session.cookieHeader;

const scenarios = [
  {
    name: "pdf-drive",
    format: "pdf",
    template: "report",
    provider: "google_drive",
  },
  {
    name: "docx-docs",
    format: "docx",
    template: "brief",
    provider: "google_docs",
  },
  {
    name: "xlsx-sheets",
    format: "xlsx",
    template: "spreadsheet",
    provider: "google_sheets",
  },
  {
    name: "pptx-slides",
    format: "pptx",
    template: "deck",
    provider: "google_slides",
  },
];

const results = [];
for (const scenario of scenarios) {
  const generated = await generateAgentFile(seed, cookieHeader, scenario);
  const withGenerated = { ...scenario, generated };
  const exported = await exportAgentFile(seed, cookieHeader, withGenerated);
  results.push({
    name: scenario.name,
    format: scenario.format,
    provider: scenario.provider,
    generated,
    exported,
  });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      apiBaseUrl: API_BASE_URL,
      preflight,
      grant: {
        userId: grant.userId,
        workspaceId: grant.workspaceId,
        accountEmail: grant.accountEmail,
        scopes: grant.scopes,
        workspaceRole: grant.workspaceRole,
      },
      seed,
      results,
    },
    null,
    2,
  ),
);
