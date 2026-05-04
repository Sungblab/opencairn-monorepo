import http from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.env.PORT ?? 4000);

const seedBase = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "e2e-mock@example.com",
  cookieName: "opencairn-e2e-session",
  cookieValue: "mock-session",
  wsSlug: "e2e-mock-ws",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  projectId: "00000000-0000-4000-8000-000000000003",
  noteId: "00000000-0000-4000-8000-000000000004",
};

const fixtureThread = {
  id: "fixture-thread",
  title: "Fixture thread",
  updated_at: new Date("2026-04-29T00:00:00.000Z").toISOString(),
  created_at: new Date("2026-04-29T00:00:00.000Z").toISOString(),
};

const sessions = new Map();

const emptyGraphResponse = {
  viewType: "graph",
  layout: "fcose",
  rootId: null,
  nodes: [],
  edges: [],
  cards: [],
  evidenceBundles: [],
  truncated: false,
  totalConcepts: 0,
};

function makeSeed() {
  return {
    ...seedBase,
    cookieValue: `mock-session-${randomUUID()}`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

function makeSession() {
  const seed = makeSeed();
  return {
    seed,
    researchApproved: false,
    threads: [{ ...fixtureThread }],
    messages: new Map([[fixtureThread.id, []]]),
  };
}

function cookieValue(req) {
  const header = req.headers.cookie ?? "";
  const cookie = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${seedBase.cookieName}=`));
  return cookie?.slice(seedBase.cookieName.length + 1);
}

function sessionFor(req) {
  const value = cookieValue(req);
  if (value && sessions.has(value)) return sessions.get(value);
  const fallback = {
    seed: {
      ...seedBase,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    researchApproved: false,
    threads: [{ ...fixtureThread }],
    messages: new Map([[fixtureThread.id, []]]),
  };
  return fallback;
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": process.env.CORS_ORIGIN ?? "http://localhost:3000",
    "access-control-allow-credentials": "true",
  });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  json(res, 404, { error: "not_found" });
}

function readBody(req) {
  return new Promise((resolve) => {
    let settled = false;
    const chunks = [];
    const finish = (body) => {
      if (settled) return;
      settled = true;
      resolve(body);
    };

    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("error", () => finish({}));
    req.on("aborted", () => finish({}));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        finish(raw ? JSON.parse(raw) : {});
      } catch {
        finish({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  let session = sessionFor(req);
  let seed = session.seed;
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": process.env.CORS_ORIGIN ?? "http://localhost:3000",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type,x-internal-secret",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    });
    res.end();
    return;
  }

  if (url.pathname === "/api/health") return json(res, 200, { ok: true });
  if (url.pathname === "/api/auth/me") {
    return json(res, 200, {
      userId: seed.userId,
      email: seed.email,
      name: "E2E Mock User",
    });
  }

  if (url.pathname === "/api/internal/test-seed" && req.method === "POST") {
    session = makeSession();
    seed = session.seed;
    sessions.set(seed.cookieValue, session);
    return json(res, 200, {
      ...seed,
      sessionCookie: `${seed.cookieName}=${seed.cookieValue}; Path=/; HttpOnly; SameSite=Lax`,
    });
  }

  if (url.pathname === `/api/workspaces/by-slug/${seed.wsSlug}`) {
    return json(res, 200, { id: seed.workspaceId, slug: seed.wsSlug });
  }

  if (url.pathname === "/api/workspaces/me") {
    return json(res, 200, {
      workspaces: [
        {
          id: seed.workspaceId,
          slug: seed.wsSlug,
          name: "E2E Mock Workspace",
          role: "owner",
        },
      ],
      invites: [],
    });
  }

  if (url.pathname === `/api/workspaces/${seed.workspaceId}/projects`) {
    return json(res, 200, [
      { id: seed.projectId, name: "E2E Mock Project", workspaceId: seed.workspaceId },
    ]);
  }

  if (url.pathname === `/api/projects/${seed.projectId}`) {
    return json(res, 200, {
      id: seed.projectId,
      workspaceId: seed.workspaceId,
      name: "E2E Mock Project",
    });
  }

  if (url.pathname === `/api/projects/${seed.projectId}/tree`) {
    return json(res, 200, {
      nodes: [
        {
          kind: "note",
          id: seed.noteId,
          parent_id: null,
          label: "E2E Mock Note",
          child_count: 0,
          file_kind: null,
          mime_type: null,
        },
      ],
    });
  }

  if (url.pathname === `/api/projects/${seed.projectId}/knowledge-surface`) {
    return json(res, 200, {
      ...emptyGraphResponse,
      viewType: url.searchParams.get("view") ?? "graph",
      layout: url.searchParams.get("view") === "mindmap" ? "dagre" : "fcose",
      rootId: url.searchParams.get("root"),
    });
  }

  if (url.pathname === `/api/projects/${seed.projectId}/graph`) {
    return json(res, 200, {
      ...emptyGraphResponse,
      viewType: url.searchParams.get("view") ?? "timeline",
      layout: "preset",
      rootId: url.searchParams.get("root"),
    });
  }

  const graphExpandMatch = url.pathname.match(
    /^\/api\/projects\/([^/]+)\/graph\/expand\/([^/]+)$/,
  );
  if (graphExpandMatch && graphExpandMatch[1] === seed.projectId) {
    return json(res, 200, { nodes: [], edges: [] });
  }

  if (url.pathname === `/api/notes/${seed.noteId}`) {
    return json(res, 200, {
      id: seed.noteId,
      projectId: seed.projectId,
      workspaceId: seed.workspaceId,
      folderId: null,
      inheritParent: true,
      title: "E2E Mock Note",
      content: [{ type: "p", children: [{ text: "" }] }],
      contentText: "",
      type: "note",
      sourceType: null,
      sourceFileKey: null,
      sourceUrl: null,
      canvasLanguage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  if (url.pathname === "/api/notes/n-smoke") {
    return json(res, 200, {
      id: "n-smoke",
      projectId: seed.projectId,
      workspaceId: seed.workspaceId,
      folderId: null,
      inheritParent: false,
      title: "Smoke topic",
      content: [
        {
          type: "research-meta",
          runId: "r-smoke",
          model: "deep-research-preview-04-2026",
          plan: "Plan body",
          sources: [],
          children: [{ text: "" }],
        },
        { type: "p", children: [{ text: "Report body" }] },
      ],
      contentText: "Report body",
      type: "note",
      sourceType: null,
      sourceFileKey: null,
      sourceUrl: null,
      mimeType: null,
      isAuto: true,
      createdAt: "2026-04-25T00:30:00Z",
      updatedAt: "2026-04-25T00:30:00Z",
      deletedAt: null,
    });
  }

  if (url.pathname === "/api/notes/n-smoke/role") {
    return json(res, 200, { role: "owner" });
  }

  if (url.pathname === "/api/threads" && req.method === "GET") {
    return json(res, 200, { threads: session.threads });
  }

  if (url.pathname === "/api/threads" && req.method === "POST") {
    await readBody(req);
    const now = new Date().toISOString();
    const id = randomUUID();
    session.threads.unshift({
      id,
      title: "",
      updated_at: now,
      created_at: now,
    });
    session.messages.set(id, []);
    return json(res, 201, {
      id,
      title: "",
    });
  }

  const messageMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
  if (messageMatch && req.method === "GET") {
    return json(res, 200, { messages: session.messages.get(messageMatch[1]) ?? [] });
  }

  if (messageMatch && req.method === "POST") {
    const body = await readBody(req);
    const threadId = messageMatch[1];
    const now = new Date().toISOString();
    const userId = randomUUID();
    const agentId = randomUUID();
    const content =
      typeof body.content === "string" && body.content.trim()
        ? body.content
        : "Mock user message";
    const messages = session.messages.get(threadId) ?? [];
    messages.push(
      {
        id: userId,
        role: "user",
        status: "complete",
        content: {
          body: content,
          ...(body.scope ? { scope: body.scope } : {}),
        },
        mode: body.mode ?? null,
        provider: null,
        created_at: now,
      },
      {
        id: agentId,
        role: "agent",
        status: "complete",
        content: {
          body: "Mock agent response.",
          status: { phrase: "mock" },
          citations: [],
          agent_files: [],
          project_objects: [],
        },
        mode: body.mode ?? null,
        provider: "mock",
        created_at: now,
      },
    );
    session.messages.set(threadId, messages);
    const thread = session.threads.find((item) => item.id === threadId);
    if (thread) thread.updated_at = now;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": process.env.CORS_ORIGIN ?? "http://localhost:3000",
      "access-control-allow-credentials": "true",
    });
    res.write(`event: agent_placeholder\ndata: ${JSON.stringify({ id: agentId })}\n\n`);
    res.write(`event: status\ndata: ${JSON.stringify({ phrase: "mock" })}\n\n`);
    res.write(`event: text\ndata: ${JSON.stringify({ delta: "Mock agent response." })}\n\n`);
    res.write(`event: done\ndata: ${JSON.stringify({ id: agentId })}\n\n`);
    res.end();
    return;
  }

  if (url.pathname === "/api/message-feedback" && req.method === "POST") {
    await readBody(req);
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/chat/conversations") {
    if (req.method === "GET") return json(res, 200, []);
    if (req.method === "POST") {
      await readBody(req);
      return json(res, 201, {
        id: "00000000-0000-4000-8000-000000000010",
        workspaceId: seed.workspaceId,
        ownerUserId: seed.userId,
        title: "Mock conversation",
        scopeType: "workspace",
        scopeId: seed.workspaceId,
        attachedChips: [],
        ragMode: "strict",
        memoryFlags: {},
      });
    }
  }

  if (url.pathname === "/api/research/runs" && req.method === "GET") {
    return json(res, 200, { runs: [] });
  }

  if (url.pathname === "/api/research/runs" && req.method === "POST") {
    session.researchApproved = false;
    await readBody(req);
    return json(res, 201, { runId: "r-smoke" });
  }

  if (url.pathname === "/api/research/runs/r-smoke" && req.method === "GET") {
    const status = session.researchApproved ? "completed" : "awaiting_approval";
    return json(res, 200, {
      id: "r-smoke",
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      topic: "Smoke topic",
      model: "deep-research-preview-04-2026",
      billingPath: "byok",
      status,
      currentInteractionId: null,
      approvedPlanText: status === "completed" ? "Plan body" : null,
      error: null,
      totalCostUsdCents: null,
      noteId: status === "completed" ? "n-smoke" : null,
      createdAt: "2026-04-25T00:00:00Z",
      updatedAt: "2026-04-25T00:00:00Z",
      completedAt: status === "completed" ? "2026-04-25T00:30:00Z" : null,
      turns: [
        {
          id: "t1",
          seq: 0,
          role: "agent",
          kind: "plan_proposal",
          interactionId: null,
          content: "1) Step\n2) Step",
          createdAt: "2026-04-25T00:00:00Z",
        },
      ],
      artifacts: [],
    });
  }

  if (
    url.pathname === "/api/research/runs/r-smoke/approve" &&
    req.method === "POST"
  ) {
    session.researchApproved = true;
    await readBody(req);
    return json(res, 202, { approved: true });
  }

  if (url.pathname === "/api/research/runs/r-smoke/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": process.env.CORS_ORIGIN ?? "http://localhost:3000",
      "access-control-allow-credentials": "true",
    });
    res.end();
    return;
  }

  if (url.pathname === "/api/visualize" && req.method === "POST") {
    await readBody(req);
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": process.env.CORS_ORIGIN ?? "http://localhost:3000",
      "access-control-allow-credentials": "true",
    });
    const viewSpec = {
      viewType: "timeline",
      layout: "preset",
      rootId: null,
      nodes: [
        {
          id: "00000000-0000-4000-8000-000000000020",
          name: "E2E Concept",
          description: "",
          degree: 0,
          noteCount: 0,
          firstNoteId: seed.noteId,
        },
      ],
      edges: [],
    };
    res.write(
      `event: tool_use\ndata: ${JSON.stringify({ tool: "search_concepts" })}\n\n`,
    );
    res.write(
      `event: tool_result\ndata: ${JSON.stringify({ tool: "search_concepts", ok: true })}\n\n`,
    );
    res.write(
      `event: view_spec\ndata: ${JSON.stringify({ viewSpec })}\n\n`,
    );
    res.write("event: done\ndata: {}\n\n");
    res.end();
    return;
  }

  if (url.pathname === "/api/agents/plan8/overview") {
    return json(res, 200, {
      project: { id: seed.projectId, workspaceId: seed.workspaceId },
      launch: {
        notes: [
          {
            id: seed.noteId,
            title: "E2E Mock Note",
            type: "note",
            updatedAt: new Date("2026-05-04T00:00:00.000Z").toISOString(),
          },
        ],
        concepts: [
          {
            id: "00000000-0000-4000-8000-000000000020",
            name: "E2E Concept",
            description: null,
            createdAt: new Date("2026-05-04T00:00:00.000Z").toISOString(),
          },
        ],
      },
      agentRuns: [
        {
          runId: "e2e-run-synthesis",
          agentName: "synthesis",
          workflowId: "e2e-synthesis-workflow",
          status: "completed",
          startedAt: new Date("2026-05-04T00:20:00.000Z").toISOString(),
          endedAt: new Date("2026-05-04T00:21:00.000Z").toISOString(),
          totalCostKrw: 0,
          errorMessage: null,
        },
      ],
      suggestions: [
        {
          id: "e2e-suggestion",
          type: "synthesis_insight",
          payload: { title: "E2E insight", confidence: 0.9 },
          status: "open",
          createdAt: new Date("2026-05-04T00:22:00.000Z").toISOString(),
          resolvedAt: null,
        },
      ],
      staleAlerts: [
        {
          id: "e2e-stale-alert",
          noteId: seed.noteId,
          noteTitle: "E2E Mock Note",
          stalenessScore: 0.37,
          reason: "Fixture stale signal",
          detectedAt: new Date("2026-05-04T00:23:00.000Z").toISOString(),
          reviewedAt: null,
        },
      ],
      audioFiles: [
        {
          id: "e2e-audio",
          noteId: seed.noteId,
          noteTitle: "E2E Mock Note",
          durationSec: 92,
          voices: [{ name: "Host", style: "educational" }],
          createdAt: new Date("2026-05-04T00:24:00.000Z").toISOString(),
          urlPath: "/api/agents/plan8/audio-files/e2e-audio/file",
        },
      ],
    });
  }

  if (url.pathname === "/api/synthesis/run" && req.method === "POST") {
    await readBody(req);
    return json(res, 202, { workflowId: "e2e-synthesis-workflow" });
  }

  if (
    [
      "/api/curator/run",
      "/api/connector/run",
      "/api/agents/temporal/stale-check",
      "/api/narrator/run",
    ].includes(url.pathname) &&
    req.method === "POST"
  ) {
    await readBody(req);
    return json(res, 202, { workflowId: "e2e-agent-workflow" });
  }

  notFound(res);
});

server.listen(port, () => {
  console.log(`[mock-api] listening on http://localhost:${port}`);
});
