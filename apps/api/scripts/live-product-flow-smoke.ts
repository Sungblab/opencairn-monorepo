import { createHash, randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as Y from "yjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
try {
  process.loadEnvFile(resolve(repoRoot, ".env"));
} catch {
  // Environment can be supplied by the caller.
}

const apiBase =
  process.env.OPENCAIRN_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.API_BASE ??
  "http://localhost:4000";
const webBase =
  process.env.OPENCAIRN_WEB_ORIGIN ??
  process.env.PLAYWRIGHT_BASE_URL ??
  "http://localhost:3000";
const artifactDir = resolve(repoRoot, "output/playwright");
const reportPath = resolve(artifactDir, "live-product-flow-smoke-report.json");
const graphScreenshotPath = resolve(artifactDir, "live-product-flow-graph.png");
const synthesisScreenshotPath = resolve(
  artifactDir,
  "live-product-flow-synthesis-export.png",
);
const keep = process.argv.includes("--keep");
const keepOnFailure = process.argv.includes("--keep-on-failure");
const requireCodeAgent = process.argv.includes("--require-code-agent");
const requireSynthesisExport = process.argv.includes("--require-synthesis-export");
const pollMs = Number(process.env.OPENCAIRN_LIVE_SMOKE_POLL_MS ?? 2_000);
const codeAgentTimeoutMs = Number(
  process.env.OPENCAIRN_LIVE_SMOKE_CODE_AGENT_TIMEOUT_MS ?? 180_000,
);
const synthesisTimeoutMs = Number(
  process.env.OPENCAIRN_LIVE_SMOKE_SYNTHESIS_TIMEOUT_MS ?? 240_000,
);

type Seed = {
  userId: string;
  workspaceId: string;
  wsSlug: string;
  projectId: string;
  noteId: string;
  cookieName: string;
  cookieValue: string;
  expiresAt: Date;
};

type JsonResponse = {
  status: number;
  body: unknown;
};

const objectKeysToRemove = new Set<string>();

type JsonRecord = Record<string, unknown>;

type AgentActionBody = {
  action?: {
    id: string;
    status: string;
    result?: JsonRecord;
    preview?: JsonRecord;
  };
};

type CodeRunBody = {
  runId?: string;
};

type SynthesisRunsBody = {
  runs?: Array<{ id: string; status: string; format: string }>;
};

type SynthesisRunDetailBody = {
  documents?: Array<{ s3Key?: string | null }>;
};

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} was not an object`);
  }
  return value as JsonRecord;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} was not a string`);
  return value;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} was not a finite number`);
  }
  return value;
}

function actionBody(res: JsonResponse, label: string): Required<AgentActionBody> {
  const body = res.body as AgentActionBody;
  if (!body.action) throw new Error(`${label} response did not include action`);
  return { action: body.action };
}

function writeSafeReport(report: JsonRecord) {
  // Keep this artifact deterministic and bounded. Do not persist raw network
  // response bodies; the script throws the detailed runtime error to stderr.
  return writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
}

function cookie(seed: Pick<Seed, "cookieName" | "cookieValue">) {
  return `${seed.cookieName}=${seed.cookieValue}`;
}

function sha256(text: string) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function sleep(ms: number) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function parseResponse(res: Response): Promise<JsonResponse> {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

async function authedJson(seed: Seed, path: string, init: RequestInit = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Cookie: cookie(seed),
      Origin: webBase,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return parseResponse(res);
}

async function internalJson(path: string, init: RequestInit = {}) {
  const secret = process.env.INTERNAL_API_SECRET;
  assert(secret, "INTERNAL_API_SECRET is required for internal live smoke");
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "X-Internal-Secret": secret,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return parseResponse(res);
}

async function createSeed(): Promise<Seed> {
  const [
    { db, user, workspaces, workspaceMembers, projects, notes, yjsDocuments },
    { signSessionForUser },
    { transformYjsStateWithPlateValue },
    { plateValueToText },
  ] = await Promise.all([
    import("@opencairn/db"),
    import("../src/lib/test-session"),
    import("../src/lib/yjs-plate-transform"),
    import("../src/lib/plate-text"),
  ]);

  const userId = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const noteId = randomUUID();
  const wsSlug = `live-product-${workspaceId.slice(0, 8)}`;
  const initialPlate = [
    {
      type: "p",
      id: "live-product-block-1",
      children: [
        {
          text:
            "Live product synthesis source marker OC-LIVE-SYNTHESIS-SOURCE-2026-05-08",
        },
      ],
    },
  ];
  const empty = new Y.Doc();
  const transformed = transformYjsStateWithPlateValue({
    currentState: Y.encodeStateAsUpdate(empty),
    draft: initialPlate,
  });

  await db.insert(user).values({
    id: userId,
    email: `live-product-${userId}@example.com`,
    name: `Live Product ${userId.slice(0, 8)}`,
    emailVerified: true,
    locale: "ko",
    timezone: "Asia/Seoul",
  });
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: wsSlug,
    name: "Live product smoke workspace",
    ownerId: userId,
    planType: "free",
  });
  await db.insert(workspaceMembers).values({
    workspaceId,
    userId,
    role: "owner",
  });
  await db.insert(projects).values({
    id: projectId,
    workspaceId,
    name: "Live product smoke project",
    createdBy: userId,
    defaultRole: "editor",
  });
  await db.insert(notes).values({
    id: noteId,
    projectId,
    workspaceId,
    title: "Live product synthesis source",
    inheritParent: true,
    content: transformed.plateValue,
    contentText: plateValueToText(transformed.plateValue),
  });
  await db.insert(yjsDocuments).values({
    name: `page:${noteId}`,
    state: transformed.state,
    stateVector: transformed.stateVector,
    sizeBytes: transformed.state.byteLength,
  });

  const session = await signSessionForUser(userId);
  return {
    userId,
    workspaceId,
    wsSlug,
    projectId,
    noteId,
    cookieName: session.name,
    cookieValue: session.value,
    expiresAt: session.expiresAt,
  };
}

async function cleanupSeed(seed: Seed | null) {
  const [{ db, eq, user, workspaces }, { getBucket, getS3Client }] =
    await Promise.all([import("@opencairn/db"), import("../src/lib/s3")]);

  for (const key of objectKeysToRemove) {
    try {
      await getS3Client().removeObject(getBucket(), key);
    } catch {
      // Best effort only. The report records generated keys.
    }
  }

  if (!seed) return;
  await db.delete(workspaces).where(eq(workspaces.id, seed.workspaceId));
  await db.delete(user).where(eq(user.id, seed.userId));
}

async function verifyNoteActions(seed: Seed) {
  const create = await authedJson(seed, `/api/projects/${seed.projectId}/agent-actions`, {
    method: "POST",
    body: JSON.stringify({
      requestId: randomUUID(),
      kind: "note.create",
      risk: "write",
      input: { title: "Live agent-created note", folderId: null },
    }),
  });
  assert(create.status === 201, `note.create expected 201, got ${create.status}`);
  const createAction = actionBody(create, "note.create").action;
  assert(createAction.status === "completed", "note.create action did not complete");
  const createResult = asRecord(createAction.result, "note.create result");
  const createdNoteId = asString(
    asRecord(createResult.note, "note.create result note").id,
    "note.create note id",
  );

  const draftContent = [
    {
      type: "p",
      id: "live-product-block-1",
      children: [{ text: "updated live note marker OC-LIVE-NOTE-UPDATE-2026-05-08" }],
    },
  ];
  const update = await authedJson(seed, `/api/projects/${seed.projectId}/agent-actions`, {
    method: "POST",
    body: JSON.stringify({
      requestId: randomUUID(),
      kind: "note.update",
      risk: "write",
      input: {
        noteId: seed.noteId,
        draft: { format: "plate_value_v1", content: draftContent },
        reason: "live product flow smoke",
      },
    }),
  });
  assert(update.status === 201, `note.update preview expected 201, got ${update.status}`);
  const updateAction = actionBody(update, "note.update preview").action;
  assert(updateAction.status === "draft", "note.update action did not stay in draft");
  const vector = asString(
    asRecord(asRecord(updateAction.preview, "note.update preview").current, "note.update current")
      .yjsStateVectorBase64,
    "note.update yjs state vector",
  );
  assert(vector, "note.update preview did not include yjs state vector");

  const applied = await authedJson(seed, `/api/agent-actions/${updateAction.id}/apply`, {
    method: "POST",
    body: JSON.stringify({ yjsStateVectorBase64: vector }),
  });
  assert(applied.status === 200, `note.update apply expected 200, got ${applied.status}`);
  const appliedAction = actionBody(applied, "note.update apply").action;
  assert(appliedAction.status === "completed", "note.update apply did not complete");
  const appliedResult = asRecord(appliedAction.result, "note.update apply result");
  const appliedContent = asString(
    asRecord(appliedResult.applied, "note.update applied").contentText,
    "note.update applied contentText",
  );
  assert(
    appliedContent.includes("OC-LIVE-NOTE-UPDATE-2026-05-08"),
    "note.update applied content marker missing",
  );

  return {
    createdNote: true,
    createStatus: "completed",
    updateStatus: "completed",
    updateText: "OC-LIVE-NOTE-UPDATE-2026-05-08",
  };
}

async function verifyCodeWorkspaceActions(seed: Seed) {
  const htmlV1 = [
    "<!doctype html>",
    "<html><head><title>OpenCairn live code smoke</title></head>",
    "<body><main id=\"app\">OC-LIVE-CODE-V1</main></body></html>",
  ].join("");
  const htmlV2 = [
    "<!doctype html>",
    "<html><head><title>OpenCairn live code smoke</title></head>",
    "<body><main id=\"app\">OC-LIVE-CODE-V2</main><script>window.__ocSmoke = true;</script></body></html>",
  ].join("");
  const create = await authedJson(seed, `/api/projects/${seed.projectId}/agent-actions`, {
    method: "POST",
    body: JSON.stringify({
      requestId: randomUUID(),
      kind: "code_project.create",
      risk: "write",
      input: {
        name: "Live code smoke",
        description: "Temporary workspace created by live product smoke",
        language: "html",
        framework: "vanilla",
        manifest: {
          entries: [
            {
              path: "index.html",
              kind: "file",
              language: "html",
              mimeType: "text/html",
              bytes: Buffer.byteLength(htmlV1),
              contentHash: sha256(htmlV1),
              inlineContent: htmlV1,
            },
          ],
        },
      },
    }),
  });
  assert(create.status === 201, `code_project.create expected 201, got ${create.status}`);
  const createAction = actionBody(create, "code_project.create").action;
  assert(createAction.status === "completed", "code_project.create did not complete");

  const createResult = asRecord(createAction.result, "code_project.create result");
  const workspace = asRecord(createResult.workspace, "code_project workspace");
  const snapshot = asRecord(createResult.snapshot, "code_project snapshot");
  const workspaceId = asString(workspace.id, "code_project workspace id");
  const snapshotId = asString(snapshot.id, "code_project snapshot id");
  const patch = await authedJson(seed, `/api/projects/${seed.projectId}/agent-actions`, {
    method: "POST",
    body: JSON.stringify({
      requestId: randomUUID(),
      kind: "code_project.patch",
      risk: "write",
      input: {
        codeWorkspaceId: workspaceId,
        baseSnapshotId: snapshotId,
        operations: [
          {
            op: "update",
            path: "index.html",
            beforeHash: sha256(htmlV1),
            afterHash: sha256(htmlV2),
            inlineContent: htmlV2,
          },
        ],
        preview: {
          filesChanged: 1,
          additions: 2,
          deletions: 1,
          summary: "Update live smoke HTML marker",
        },
      },
    }),
  });
  assert(patch.status === 201, `code_project.patch expected 201, got ${patch.status}`);
  const patchAction = actionBody(patch, "code_project.patch").action;
  assert(patchAction.status === "draft", "code_project.patch did not create draft action");

  const applied = await authedJson(seed, `/api/agent-actions/${patchAction.id}/apply`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert(applied.status === 200, `code_project.patch apply expected 200, got ${applied.status}`);
  const appliedAction = actionBody(applied, "code_project.patch apply").action;
  assert(appliedAction.status === "completed", "code_project.patch apply did not complete");
  const appliedResult = asRecord(appliedAction.result, "code_project.patch apply result");
  const patchedSnapshotId = asString(
    asRecord(appliedResult.snapshot, "code_project.patch snapshot").id,
    "code_project.patch snapshot id",
  );

  const archive = await fetch(
    `${apiBase}/api/code-workspaces/${workspaceId}/snapshots/${patchedSnapshotId}/archive`,
    { headers: { Cookie: cookie(seed), Origin: webBase } },
  );
  const archiveBytes = new Uint8Array(await archive.arrayBuffer());
  assert(archive.status === 200, `code workspace archive expected 200, got ${archive.status}`);
  assert(
    archiveBytes[0] === 0x50 && archiveBytes[1] === 0x4b,
    "code workspace archive is not a zip",
  );

  return {
    workspaceCreated: true,
    initialSnapshotCreated: true,
    patchedSnapshotCreated: true,
    archiveZipVerified: true,
  };
}

async function verifyGraph(seed: Seed) {
  const { db, concepts, conceptEdges, conceptNotes } = await import("@opencairn/db");
  const conceptA = randomUUID();
  const conceptB = randomUUID();
  await db.insert(concepts).values([
    {
      id: conceptA,
      projectId: seed.projectId,
      name: "Live Graph Source",
      description: "Seeded source concept for browser graph smoke",
    },
    {
      id: conceptB,
      projectId: seed.projectId,
      name: "Live Graph Target",
      description: "Seeded target concept for browser graph smoke",
    },
  ]);
  await db.insert(conceptNotes).values([
    { conceptId: conceptA, noteId: seed.noteId },
    { conceptId: conceptB, noteId: seed.noteId },
  ]);
  await db.insert(conceptEdges).values({
    id: randomUUID(),
    sourceId: conceptA,
    targetId: conceptB,
    relationType: "supports",
    weight: 0.93,
    evidenceNoteId: seed.noteId,
  });

  const graph = await authedJson(seed, `/api/projects/${seed.projectId}/graph?view=graph&limit=50`);
  assert(
    graph.status === 200,
    `graph API expected 200, got ${graph.status}`,
  );
  const graphBody = graph.body as { nodes?: unknown[]; edges?: unknown[] };
  assert((graphBody.nodes?.length ?? 0) >= 2, "graph API did not return seeded nodes");
  assert((graphBody.edges?.length ?? 0) >= 1, "graph API did not return seeded edge");

  await mkdir(artifactDir, { recursive: true });
  const browser = await chromium.launch();
  const webUrl = new URL(webBase);
  const context = await browser.newContext({
    baseURL: webBase,
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies([
    {
      name: seed.cookieName,
      value: seed.cookieValue,
      domain: webUrl.hostname,
      path: "/",
      httpOnly: true,
      secure: webUrl.protocol === "https:",
      sameSite: "Lax",
      expires: Math.floor(seed.expiresAt.getTime() / 1000),
    },
  ]);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  const route = `/ko/workspace/${seed.wsSlug}/project/${seed.projectId}/graph?view=graph`;
  await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForSelector('[data-testid="project-graph-viewer"]', { timeout: 45_000 });
  await page.waitForSelector('[data-testid="project-graph-viewer"][data-hydrated="true"]', {
    timeout: 10_000,
  });
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: graphScreenshotPath, fullPage: true });
  await context.close();
  await browser.close();
  const screenshot = await stat(graphScreenshotPath);
  assert(screenshot.size > 10_000, `graph screenshot too small: ${screenshot.size}`);
  assert(
    consoleErrors.length === 0,
    `graph browser console/page errors: ${consoleErrors.slice(0, 5).join(" | ")}`,
  );

  return {
    apiNodesAtLeast: 2,
    apiEdgesAtLeast: 1,
    route,
    screenshotPath: graphScreenshotPath,
    screenshotBytes: screenshot.size,
    consoleErrors: 0,
  };
}

async function verifyPdfCompile(seed: Seed) {
  const runId = seed.workspaceId;
  const s3Key = `synthesis/runs/${runId}/document.pdf`;
  objectKeysToRemove.add(s3Key);
  const compile = await internalJson("/api/internal/synthesis-export/compile", {
    method: "POST",
    body: JSON.stringify({
      run_id: runId,
      format: "pdf",
      output: {
        format: "pdf",
        title: "Live PDF Generation Smoke",
        abstract: "OC-LIVE-PDF-2026-05-08",
        sections: [
          {
            title: "검증",
            content: "<p>OpenCairn live PDF compile marker: OC-LIVE-PDF-2026-05-08.</p>",
            source_ids: [],
          },
        ],
        bibliography: [],
        template: "report",
      },
    }),
  });
  assert(compile.status === 200, `PDF compile expected 200, got ${compile.status}`);
  const compileBody = compile.body as { s3Key?: string; bytes?: number };
  assert(compileBody.s3Key === s3Key, "PDF compile did not return the expected s3Key");
  assert(asNumber(compileBody.bytes, "compiled PDF bytes") > 500, "compiled PDF bytes too small");

  const { streamObject } = await import("../src/lib/s3-get");
  const object = await streamObject(s3Key);
  const reader = object.stream.getReader();
  const first = await reader.read();
  await reader.cancel();
  const head = Buffer.from(first.value ?? []).subarray(0, 5).toString("ascii");
  assert(head === "%PDF-", `compiled object did not start with %PDF-, got ${head}`);
  assert(object.contentLength > 500, `compiled PDF too small: ${object.contentLength}`);
  return {
    objectCreated: true,
    bytesAtLeast: 500,
    contentLengthAtLeast: 500,
    pdfHeaderVerified: true,
  };
}

async function createCanvasNote(seed: Seed, language: "html" | "python" | "javascript" | "react") {
  const { db, notes } = await import("@opencairn/db");
  const canvasId = randomUUID();
  await db.insert(notes).values({
    id: canvasId,
    projectId: seed.projectId,
    workspaceId: seed.workspaceId,
    title: `Live ${language} canvas route probe`,
    type: "note",
    sourceType: "canvas",
    canvasLanguage: language,
    inheritParent: true,
    contentText: "",
  });
  return canvasId;
}

async function verifyCodeAgent(seed: Seed) {
  const canvasId = await createCanvasNote(seed, "html");
  const codeRun = await authedJson(seed, "/api/code/run", {
    method: "POST",
    body: JSON.stringify({
      noteId: canvasId,
      prompt:
        "Create a minimal HTML document. The body must contain exactly this visible marker: OC-LIVE-CODE-AGENT-2026-05-08.",
      language: "html",
    }),
  });
  if (!requireCodeAgent && codeRun.status === 404) {
    return {
      required: false,
      featureGated: true,
    };
  }
  if (!requireCodeAgent && codeRun.status !== 200) {
    return {
      required: false,
      featureGated: false,
    };
  }
  assert(codeRun.status === 200, `code agent run expected 200, got ${codeRun.status}`);
  const runId = asString((codeRun.body as CodeRunBody).runId, "code agent run id");

  const { db, codeRuns, codeTurns, eq, asc } = await import("@opencairn/db");
  const startedAt = Date.now();
  let runRow: { status?: string } | undefined;
  let turns: Array<{ source?: unknown }> = [];
  while (Date.now() - startedAt < codeAgentTimeoutMs) {
    [runRow] = await db.select().from(codeRuns).where(eq(codeRuns.id, runId));
    turns = await db
      .select()
      .from(codeTurns)
      .where(eq(codeTurns.runId, runId))
      .orderBy(asc(codeTurns.seq));
    if (turns.length > 0 && runRow?.status === "awaiting_feedback") break;
    if (runRow?.status === "failed") {
      throw new Error(`code agent run failed before feedback: ${JSON.stringify(runRow)}`);
    }
    await sleep(pollMs);
  }
  assert(turns.length > 0, "code agent did not persist a generated turn");
  assert(runRow?.status === "awaiting_feedback", `code agent did not await feedback; status=${runRow?.status}`);
  const source = String(turns[0].source ?? "");
  assert(
    source.includes("OC-LIVE-CODE-AGENT-2026-05-08"),
    "code agent generated source does not contain the smoke marker",
  );

  const browser = await chromium.launch();
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 900, height: 600 },
  });
  const page = await context.newPage();
  await page.setContent(source, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const renderedText = await page.locator("body").innerText({ timeout: 10_000 });
  await context.close();
  await browser.close();
  assert(
    renderedText.includes("OC-LIVE-CODE-AGENT-2026-05-08"),
    "browser sandbox render did not expose the code agent marker",
  );

  const feedback = await authedJson(seed, "/api/code/feedback", {
    method: "POST",
    body: JSON.stringify({
      runId,
      kind: "ok",
      stdout: renderedText.slice(0, 1000),
    }),
  });
  assert(feedback.status === 200, `code agent feedback expected 200, got ${feedback.status}`);

  const feedbackAt = Date.now();
  while (Date.now() - feedbackAt < codeAgentTimeoutMs) {
    [runRow] = await db.select().from(codeRuns).where(eq(codeRuns.id, runId));
    if (runRow?.status === "completed") break;
    const terminalStatus = runRow?.status;
    if (
      terminalStatus &&
      ["failed", "max_turns", "cancelled", "abandoned"].includes(terminalStatus)
    ) {
      throw new Error(`code agent ended unexpectedly after feedback: ${terminalStatus}`);
    }
    await sleep(pollMs);
  }
  assert(runRow?.status === "completed", `code agent did not finalize completed; status=${runRow?.status}`);

  return {
    required: requireCodeAgent,
    status: "completed",
    turnsAtLeast: 1,
    generatedBytesAtLeast: 1,
    renderedMarker: true,
  };
}

async function verifySynthesisExportUi(seed: Seed) {
  if (!requireSynthesisExport) {
    const probe = await authedJson(seed, "/api/synthesis-export/runs", {
      method: "GET",
    });
    if (probe.status === 404) return { required: false, featureGated: true };
    return { required: false, featureGated: false };
  }

  const browser = await chromium.launch();
  const webUrl = new URL(webBase);
  const context = await browser.newContext({
    acceptDownloads: true,
    baseURL: webBase,
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies([
    {
      name: seed.cookieName,
      value: seed.cookieValue,
      domain: webUrl.hostname,
      path: "/",
      httpOnly: true,
      secure: webUrl.protocol === "https:",
      sameSite: "Lax",
      expires: Math.floor(seed.expiresAt.getTime() / 1000),
    },
  ]);
  const page = await context.newPage();
  const route = `/ko/workspace/${seed.wsSlug}/synthesis-export?project=${seed.projectId}`;
  await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.getByTestId("format-select").selectOption("pdf");
  await page.getByTestId("template-select").selectOption("report");
  await page
    .getByTestId("synthesis-source-search")
    .fill("Live product synthesis source");
  await page
    .getByRole("button", { name: /Live product synthesis source/ })
    .click({ timeout: 20_000 });
  await page
    .getByTestId("synthesis-prompt")
    .fill("Create a concise Korean QA report containing marker OC-LIVE-SYNTHESIS-EXPORT-2026-05-08.");
  await page.getByTestId("synthesis-start").click();
  await page.getByRole("link", { name: /PDF 다운로드/i }).waitFor({
    state: "visible",
    timeout: synthesisTimeoutMs,
  });
  await page.screenshot({ path: synthesisScreenshotPath, fullPage: true });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("link", { name: /PDF 다운로드/i }).click(),
  ]);
  const downloadPath = await download.path();
  assert(downloadPath, "synthesis export download did not produce a local path");
  const bytes = await stat(downloadPath);
  assert(bytes.size > 500, `synthesis export PDF too small: ${bytes.size}`);

  const runs = await authedJson(
    seed,
    `/api/synthesis-export/runs?workspaceId=${seed.workspaceId}`,
  );
  const latestRun = (runs.body as SynthesisRunsBody).runs?.[0];
  assert(latestRun?.status === "completed", "latest synthesis export run did not complete");
  const detail = await authedJson(seed, `/api/synthesis-export/runs/${latestRun.id}`);
  const detailBody = detail.body as SynthesisRunDetailBody;
  assert((detailBody.documents?.length ?? 0) >= 1, "synthesis export returned no documents");
  for (const doc of detailBody.documents ?? []) {
    if (doc.s3Key) objectKeysToRemove.add(doc.s3Key);
  }

  await context.close();
  await browser.close();
  const screenshot = await stat(synthesisScreenshotPath);
  return {
    required: true,
    route,
    status: "completed",
    format: "pdf",
    downloadedBytesAtLeast: 500,
    screenshotPath: synthesisScreenshotPath,
    screenshotBytes: screenshot.size,
    documentCountAtLeast: 1,
  };
}

async function main() {
  let seed: Seed | null = null;
  let failed = false;
  const report: JsonRecord = {
    checkedAt: new Date().toISOString(),
    apiBase,
    webBase,
    requireCodeAgent,
    requireSynthesisExport,
  };
  try {
    const health = await fetch(`${apiBase}/api/health`);
    assert(health.ok, `API health expected 200, got ${health.status}`);
    seed = await createSeed();
    report.seed = {
      userId: seed.userId,
      workspaceId: seed.workspaceId,
      wsSlug: seed.wsSlug,
      projectId: seed.projectId,
      noteId: seed.noteId,
    };
    report.noteActions = await verifyNoteActions(seed);
    report.codeWorkspaceActions = await verifyCodeWorkspaceActions(seed);
    report.graph = await verifyGraph(seed);
    report.pdfCompile = await verifyPdfCompile(seed);
    report.codeAgent = await verifyCodeAgent(seed);
    report.synthesisExport = await verifySynthesisExportUi(seed);
    report.ok = true;
  } catch (error) {
    failed = true;
    report.ok = false;
    report.error = { message: "live_product_flow_smoke_failed" };
    throw error;
  } finally {
    if (!keep && !(failed && keepOnFailure)) {
      await cleanupSeed(seed);
      report.cleanedUp = true;
    } else {
      report.cleanedUp = false;
    }
    await mkdir(artifactDir, { recursive: true });
    await writeSafeReport(report);
    console.log(JSON.stringify(report, null, 2));
  }
}

main();
