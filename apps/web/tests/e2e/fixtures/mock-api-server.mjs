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

function currentSeed() {
  return {
    ...seedBase,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
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
  const seed = currentSeed();
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
      folders: [],
      notes: [
        {
          id: seed.noteId,
          title: "E2E Mock Note",
          projectId: seed.projectId,
          folderId: null,
          sourceType: null,
        },
      ],
    });
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

  if (url.pathname === "/api/threads" && req.method === "GET") {
    return json(res, 200, { threads: [fixtureThread] });
  }

  if (url.pathname === "/api/threads" && req.method === "POST") {
    await readBody(req);
    const id = randomUUID();
    return json(res, 201, {
      id,
      title: "",
    });
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

  notFound(res);
});

server.listen(port, () => {
  console.log(`[mock-api] listening on http://localhost:${port}`);
});
