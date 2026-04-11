# Plan 7: Canvas & Sandbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OpenCairn Canvas & Sandbox system — an isolated code execution environment (gVisor Docker) paired with a React canvas builder (Vite) that lets the Code Agent generate interactive components and deliver them to the frontend via a sandboxed iframe. Canvas templates (slides, mindmap, cheatsheet) from Plan 6 are rendered through this pipeline.

**Architecture:**
1. **Sandbox Docker service** (`services/sandbox/`) — a gVisor-runtime container exposing an HTTP API. Receives Python or JavaScript source, executes it in isolation, and returns stdout + produced files (base64).
2. **React canvas builder** (`services/sandbox/canvas-builder/`) — a Vite SSR-less build service running inside the same container. Receives React JSX/TSX source, wraps it in a minimal Vite project, builds to static HTML+JS, and serves it on a per-job URL.
3. **Sandbox API routes** (`apps/api/src/routes/sandbox.ts`) — Hono proxy that forwards execution requests to the sandbox service, authenticates users, tracks job records, and returns signed iframe URLs.
4. **Frontend iframe renderer** (`apps/web/src/components/canvas/`) — a `<CanvasFrame>` component that renders a sandboxed `<iframe>` pointing at the built canvas URL, with `postMessage` for bi-directional communication.
5. **Code Agent** (`apps/api/src/agents/code/`) — a LangGraph graph: generate code → execute in sandbox → analyze stdout/errors → optionally iterate → return final result.
6. **Canvas template integration** — canvas-renderer templates (slides, mindmap, cheatsheet) from `@opencairn/templates` feed the Code Agent, which generates a React component, builds it via the canvas builder, and returns an iframe URL.

**Tech Stack:** Turborepo, Next.js 16, Hono 4, Docker + gVisor (runsc), Vite 6, LangGraph (TypeScript), Zod, Tailwind CSS 4, pnpm

---

## File Structure

```
services/
  sandbox/
    Dockerfile                       -- gVisor-ready Node.js + Python image
    docker-compose.override.yml      -- dev override: mount source, runsc runtime
    package.json                     -- Express HTTP service
    tsconfig.json
    src/
      index.ts                       -- Express app, listen on port 5050
      routes/
        execute.ts                   -- POST /execute (Python | JS)
        canvas.ts                    -- POST /canvas/build, GET /canvas/:jobId
      executors/
        python.ts                    -- spawn python3 in gVisor-isolated subprocess
        javascript.ts                -- spawn node in gVisor-isolated subprocess
      canvas-builder/
        builder.ts                   -- Vite programmatic build for React components
        template/
          index.html                 -- minimal HTML shell
          main.tsx                   -- mounts user component as <App />
          vite.config.ts             -- Vite config (React plugin, outDir per jobId)
      lib/
        jobs.ts                      -- in-memory job store (dev); swap for Redis in prod
        limits.ts                    -- timeout, max output size constants

apps/
  api/
    src/
      routes/
        sandbox.ts                   -- Hono proxy to sandbox service
      agents/
        code/
          state.ts                   -- LangGraph state shape
          nodes/
            generate-code.ts         -- generate Python/JS/React from prompt
            execute-code.ts          -- call sandbox API, capture result
            analyze-result.ts        -- interpret stdout/errors, decide retry
            build-canvas.ts          -- send React source to canvas builder
          graph.ts                   -- LangGraph graph wiring
          index.ts                   -- export compiled graph

  web/
    src/
      components/
        canvas/
          CanvasFrame.tsx            -- sandboxed iframe renderer
          CanvasToolbar.tsx          -- reload, fullscreen, copy-link actions
          useCanvasMessages.ts       -- postMessage hook
      app/
        (app)/
          canvas/
            page.tsx                 -- canvas gallery / recent canvases
            [jobId]/
              page.tsx               -- single canvas viewer
```

---

### Task 1: Sandbox Docker Service (gVisor Runtime)

**Files:**
- Create: `services/sandbox/Dockerfile`
- Create: `services/sandbox/package.json`
- Create: `services/sandbox/tsconfig.json`
- Create: `services/sandbox/src/index.ts`
- Create: `services/sandbox/src/lib/limits.ts`
- Create: `services/sandbox/src/lib/jobs.ts`
- Edit: `docker-compose.yml` (add sandbox service)

- [ ] **Step 1: Create `services/sandbox/Dockerfile`**

```dockerfile
# Multi-stage: build TypeScript, then run in slim image
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-slim AS runner
# Install Python 3 for code execution
RUN apt-get update && apt-get install -y python3 python3-pip --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# gVisor drops capabilities — run as non-root
RUN useradd -m sandboxuser
USER sandboxuser

EXPOSE 5050
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create `services/sandbox/package.json`**

```json
{
  "name": "@opencairn/sandbox",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc"
  },
  "dependencies": {
    "express": "^4.21.0",
    "vite": "^6.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "zod": "^3.24.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 3: Create `services/sandbox/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create `services/sandbox/src/lib/limits.ts`**

```typescript
export const LIMITS = {
  EXECUTION_TIMEOUT_MS: 10_000,       // 10 s per code execution
  MAX_OUTPUT_BYTES: 256 * 1024,       // 256 KB stdout cap
  MAX_SOURCE_BYTES: 64 * 1024,        // 64 KB source code cap
  CANVAS_BUILD_TIMEOUT_MS: 30_000,    // 30 s for Vite build
  MAX_CANVAS_BUNDLE_BYTES: 4 * 1024 * 1024, // 4 MB built bundle cap
  JOB_TTL_MS: 60 * 60 * 1000,        // 1 hour job retention
} as const;
```

- [ ] **Step 5: Create `services/sandbox/src/lib/jobs.ts`**

```typescript
import { LIMITS } from "./limits";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export type ExecutionJob = {
  id: string;
  status: JobStatus;
  language: "python" | "javascript";
  source: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  files: Record<string, string>;   // filename → base64 content
  createdAt: Date;
  completedAt?: Date;
  error?: string;
};

export type CanvasJob = {
  id: string;
  status: JobStatus;
  source: string;                  // React component source
  serveUrl: string | null;         // path under /canvas/serve/:jobId
  buildError: string | null;
  createdAt: Date;
  completedAt?: Date;
};

// In-memory store — swap for Redis in production
const executionJobs = new Map<string, ExecutionJob>();
const canvasJobs = new Map<string, CanvasJob>();

export const jobStore = {
  setExecution(job: ExecutionJob) {
    executionJobs.set(job.id, job);
    // TTL cleanup
    setTimeout(() => executionJobs.delete(job.id), LIMITS.JOB_TTL_MS);
  },
  getExecution(id: string): ExecutionJob | undefined {
    return executionJobs.get(id);
  },
  setCanvas(job: CanvasJob) {
    canvasJobs.set(job.id, job);
    setTimeout(() => canvasJobs.delete(job.id), LIMITS.JOB_TTL_MS);
  },
  getCanvas(id: string): CanvasJob | undefined {
    return canvasJobs.get(id);
  },
};
```

- [ ] **Step 6: Create `services/sandbox/src/index.ts`**

```typescript
import express from "express";
import { executeRouter } from "./routes/execute";
import { canvasRouter } from "./routes/canvas";

const app = express();
app.use(express.json({ limit: "128kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/execute", executeRouter);
app.use("/canvas", canvasRouter);

const PORT = Number(process.env.PORT ?? 5050);
app.listen(PORT, () => {
  console.log(`Sandbox service listening on :${PORT}`);
});
```

- [ ] **Step 7: Add sandbox service to `docker-compose.yml`**

Open `docker-compose.yml` and add inside `services:`:

```yaml
  sandbox:
    build:
      context: ./services/sandbox
      dockerfile: Dockerfile
    ports:
      - "5050:5050"
    runtime: runsc          # gVisor runtime — requires gVisor installed on host
    environment:
      NODE_ENV: production
    volumes:
      - sandbox_builds:/app/canvas-builds
    depends_on:
      - postgres

volumes:
  sandbox_builds:
```

> Note: `runtime: runsc` requires gVisor (`runsc`) to be installed on the Docker host and registered as a Docker runtime. In local dev without gVisor, remove or comment out the `runtime:` line — the service still works, only without the gVisor security boundary.

- [ ] **Step 8: Commit**

```bash
git add services/sandbox/ docker-compose.yml
git commit -m "feat(sandbox): Docker service scaffold with gVisor runtime, job store, and limits"
```

---

### Task 2: Sandbox Execution API (Python + JS)

**Files:**
- Create: `services/sandbox/src/executors/python.ts`
- Create: `services/sandbox/src/executors/javascript.ts`
- Create: `services/sandbox/src/routes/execute.ts`

- [ ] **Step 1: Create `services/sandbox/src/executors/python.ts`**

```typescript
import { spawn } from "child_process";
import { LIMITS } from "../lib/limits";

export type ExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
};

export function executePython(source: string): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-c", source], {
      timeout: LIMITS.EXECUTION_TIMEOUT_MS,
      env: {
        // Minimal env — no secrets, no HOME-leakage
        PATH: "/usr/bin:/usr/local/bin",
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONUNBUFFERED: "1",
      },
      uid: process.getuid?.(),    // run as current sandboxed user
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout) > LIMITS.MAX_OUTPUT_BYTES) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code, signal) => {
      resolve({
        stdout: stdout.slice(0, LIMITS.MAX_OUTPUT_BYTES),
        stderr: stderr.slice(0, 8192),
        exitCode: code ?? -1,
        timedOut: signal === "SIGKILL",
      });
    });

    child.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, exitCode: -1, timedOut: false });
    });
  });
}
```

- [ ] **Step 2: Create `services/sandbox/src/executors/javascript.ts`**

```typescript
import { spawn } from "child_process";
import { LIMITS } from "../lib/limits";
import type { ExecutionResult } from "./python";

export function executeJavaScript(source: string): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    // Write source to stdin of node --input-type=module
    const child = spawn("node", ["--input-type=module"], {
      timeout: LIMITS.EXECUTION_TIMEOUT_MS,
      env: {
        PATH: "/usr/bin:/usr/local/bin",
        NODE_NO_WARNINGS: "1",
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout) > LIMITS.MAX_OUTPUT_BYTES) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code, signal) => {
      resolve({
        stdout: stdout.slice(0, LIMITS.MAX_OUTPUT_BYTES),
        stderr: stderr.slice(0, 8192),
        exitCode: code ?? -1,
        timedOut: signal === "SIGKILL",
      });
    });
    child.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, exitCode: -1, timedOut: false });
    });

    child.stdin.write(source);
    child.stdin.end();
  });
}
```

- [ ] **Step 3: Create `services/sandbox/src/routes/execute.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { executePython } from "../executors/python";
import { executeJavaScript } from "../executors/javascript";
import { jobStore } from "../lib/jobs";
import { LIMITS } from "../lib/limits";

export const executeRouter = Router();

const executeSchema = z.object({
  language: z.enum(["python", "javascript"]),
  source: z.string().max(LIMITS.MAX_SOURCE_BYTES),
});

// POST /execute — synchronous execution (returns when done)
executeRouter.post("/", async (req, res) => {
  const parsed = executeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { language, source } = parsed.data;
  const id = uuid();
  const createdAt = new Date();

  const job = {
    id,
    status: "running" as const,
    language,
    source,
    stdout: "",
    stderr: "",
    exitCode: null,
    files: {},
    createdAt,
  };
  jobStore.setExecution({ ...job });

  try {
    const result =
      language === "python"
        ? await executePython(source)
        : await executeJavaScript(source);

    const completed = {
      ...job,
      status: (result.exitCode === 0 ? "completed" : "failed") as const,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      completedAt: new Date(),
      error: result.timedOut ? "Execution timed out" : undefined,
    };
    jobStore.setExecution(completed);
    return res.json(completed);
  } catch (err) {
    const failed = {
      ...job,
      status: "failed" as const,
      error: String(err),
      completedAt: new Date(),
    };
    jobStore.setExecution(failed);
    return res.status(500).json(failed);
  }
});

// GET /execute/:id — retrieve a past job
executeRouter.get("/:id", (req, res) => {
  const job = jobStore.getExecution(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  return res.json(job);
});
```

- [ ] **Step 4: Commit**

```bash
git add services/sandbox/src/executors/ services/sandbox/src/routes/execute.ts
git commit -m "feat(sandbox): Python and JavaScript execution routes with output size limits"
```

---

### Task 3: React Canvas Builder (Vite)

**Files:**
- Create: `services/sandbox/src/canvas-builder/template/index.html`
- Create: `services/sandbox/src/canvas-builder/template/main.tsx`
- Create: `services/sandbox/src/canvas-builder/template/vite.config.ts`
- Create: `services/sandbox/src/canvas-builder/builder.ts`
- Create: `services/sandbox/src/routes/canvas.ts`

- [ ] **Step 1: Create canvas Vite template files**

Create `services/sandbox/src/canvas-builder/template/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenCairn Canvas</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

Create `services/sandbox/src/canvas-builder/template/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// USER_COMPONENT is injected by the builder at build time
import App from "./UserComponent";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

Create `services/sandbox/src/canvas-builder/template/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: process.env.VITE_OUT_DIR ?? "dist",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 2: Create `services/sandbox/src/canvas-builder/builder.ts`**

```typescript
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { writeFileSync, mkdirSync, cpSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { LIMITS } from "../lib/limits";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(__dirname, "template");
const BUILDS_DIR = process.env.CANVAS_BUILDS_DIR ?? resolve(__dirname, "../../../canvas-builds");

export type BuildResult = {
  success: boolean;
  serveDir: string | null;
  error: string | null;
  durationMs: number;
};

/**
 * Builds a React component source string into a static bundle using Vite.
 * Returns the directory path that can be served as static files.
 */
export async function buildReactCanvas(
  jobId: string,
  reactSource: string
): Promise<BuildResult> {
  const start = Date.now();
  const outDir = resolve(BUILDS_DIR, jobId);

  try {
    if (Buffer.byteLength(reactSource) > LIMITS.MAX_SOURCE_BYTES) {
      throw new Error("React source exceeds maximum allowed size.");
    }

    // Write user component into a temp project dir
    const projectDir = resolve(BUILDS_DIR, `${jobId}_src`);
    mkdirSync(projectDir, { recursive: true });

    // Copy template files
    cpSync(TEMPLATE_DIR, projectDir, { recursive: true });

    // Write the user's component as UserComponent.tsx
    writeFileSync(resolve(projectDir, "UserComponent.tsx"), reactSource, "utf-8");

    // Programmatic Vite build
    await build({
      root: projectDir,
      plugins: [react()],
      build: {
        outDir,
        emptyOutDir: true,
      },
      logLevel: "silent",
    });

    return { success: true, serveDir: outDir, error: null, durationMs: Date.now() - start };
  } catch (err) {
    return {
      success: false,
      serveDir: null,
      error: String(err),
      durationMs: Date.now() - start,
    };
  }
}
```

- [ ] **Step 3: Create `services/sandbox/src/routes/canvas.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import express from "express";
import { resolve } from "path";
import { buildReactCanvas } from "../canvas-builder/builder";
import { jobStore } from "../lib/jobs";
import { LIMITS } from "../lib/limits";

export const canvasRouter = Router();

const buildSchema = z.object({
  source: z.string().max(LIMITS.MAX_SOURCE_BYTES),
});

// POST /canvas/build — accept React source, build asynchronously, return jobId
canvasRouter.post("/build", async (req, res) => {
  const parsed = buildSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const id = uuid();
  const job = {
    id,
    status: "queued" as const,
    source: parsed.data.source,
    serveUrl: null,
    buildError: null,
    createdAt: new Date(),
  };
  jobStore.setCanvas(job);

  // Return immediately; build runs in background
  res.status(202).json({ jobId: id, status: "queued" });

  // Background build
  const result = await buildReactCanvas(id, parsed.data.source);
  jobStore.setCanvas({
    ...job,
    status: result.success ? "completed" : "failed",
    serveUrl: result.success ? `/canvas/serve/${id}` : null,
    buildError: result.error,
    completedAt: new Date(),
  });
});

// GET /canvas/:jobId — poll job status
canvasRouter.get("/:jobId", (req, res) => {
  const job = jobStore.getCanvas(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Canvas job not found" });
  return res.json(job);
});

// Serve built static files
const BUILDS_DIR = process.env.CANVAS_BUILDS_DIR ?? resolve(process.cwd(), "canvas-builds");
canvasRouter.use("/serve", express.static(BUILDS_DIR, { fallthrough: false }));
```

- [ ] **Step 4: Commit**

```bash
git add services/sandbox/src/canvas-builder/ services/sandbox/src/routes/canvas.ts
git commit -m "feat(sandbox): React canvas builder with Vite programmatic build and static file serving"
```

---

### Task 4: Frontend Iframe Renderer

**Files:**
- Create: `apps/web/src/components/canvas/useCanvasMessages.ts`
- Create: `apps/web/src/components/canvas/CanvasFrame.tsx`
- Create: `apps/web/src/components/canvas/CanvasToolbar.tsx`
- Create: `apps/web/src/app/(app)/canvas/page.tsx`
- Create: `apps/web/src/app/(app)/canvas/[jobId]/page.tsx`

- [ ] **Step 1: Create `apps/web/src/components/canvas/useCanvasMessages.ts`**

```typescript
"use client";

import { useEffect, useRef, useCallback } from "react";

export type CanvasMessage =
  | { type: "CANVAS_READY" }
  | { type: "CANVAS_ERROR"; error: string }
  | { type: "CANVAS_RESIZE"; height: number }
  | { type: "HOST_THEME"; theme: "light" | "dark" };

type UseCanvasMessagesOptions = {
  onMessage: (msg: CanvasMessage) => void;
  sandboxOrigin: string;
};

/**
 * Hook for bi-directional postMessage communication with a sandboxed canvas iframe.
 * Returns a `send` function to post messages into the iframe.
 */
export function useCanvasMessages(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  { onMessage, sandboxOrigin }: UseCanvasMessagesOptions
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    function handler(event: MessageEvent) {
      if (event.origin !== sandboxOrigin) return;
      onMessageRef.current(event.data as CanvasMessage);
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [sandboxOrigin]);

  const send = useCallback(
    (msg: CanvasMessage) => {
      iframeRef.current?.contentWindow?.postMessage(msg, sandboxOrigin);
    },
    [iframeRef, sandboxOrigin]
  );

  return { send };
}
```

- [ ] **Step 2: Create `apps/web/src/components/canvas/CanvasFrame.tsx`**

```tsx
"use client";

import { useRef, useState, useCallback } from "react";
import { useCanvasMessages } from "./useCanvasMessages";

type CanvasFrameProps = {
  jobId: string;
  /** Full URL to the built canvas (served by sandbox service) */
  src: string;
  /** Expected sandbox origin, e.g. http://localhost:5050 */
  sandboxOrigin?: string;
  className?: string;
};

const SANDBOX_ORIGIN =
  process.env.NEXT_PUBLIC_SANDBOX_ORIGIN ?? "http://localhost:5050";

export function CanvasFrame({
  jobId,
  src,
  sandboxOrigin = SANDBOX_ORIGIN,
  className = "",
}: CanvasFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iframeHeight, setIframeHeight] = useState(480);

  const { send } = useCanvasMessages(iframeRef, {
    sandboxOrigin,
    onMessage: useCallback((msg) => {
      if (msg.type === "CANVAS_READY") setReady(true);
      if (msg.type === "CANVAS_ERROR") setError(msg.error);
      if (msg.type === "CANVAS_RESIZE") setIframeHeight(msg.height);
    }, []),
  });

  return (
    <div className={`relative rounded-xl overflow-hidden border border-border bg-background ${className}`}>
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
          <span className="text-sm text-muted-foreground animate-pulse">Loading canvas…</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-destructive/10 z-10 p-4">
          <p className="text-sm text-destructive text-center">Canvas error: {error}</p>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={src}
        title={`OpenCairn Canvas ${jobId}`}
        style={{ height: iframeHeight }}
        className="w-full border-0"
        // Strict sandbox: allow-scripts for React to run, allow-same-origin for postMessage
        // Do NOT add allow-forms, allow-popups, allow-top-navigation
        sandbox="allow-scripts allow-same-origin"
        loading="lazy"
        onLoad={() => {
          // Send theme on load
          send({ type: "HOST_THEME", theme: "light" });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/components/canvas/CanvasToolbar.tsx`**

```tsx
"use client";

type CanvasToolbarProps = {
  jobId: string;
  src: string;
  onReload: () => void;
};

export function CanvasToolbar({ jobId, src, onReload }: CanvasToolbarProps) {
  async function copyLink() {
    await navigator.clipboard.writeText(src);
  }

  function openFullscreen() {
    window.open(src, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
      <span className="text-xs text-muted-foreground font-mono truncate flex-1">
        canvas/{jobId}
      </span>
      <button
        onClick={onReload}
        className="text-xs px-3 py-1 rounded-md border border-border hover:bg-muted transition-colors"
        title="Reload canvas"
      >
        Reload
      </button>
      <button
        onClick={copyLink}
        className="text-xs px-3 py-1 rounded-md border border-border hover:bg-muted transition-colors"
        title="Copy link"
      >
        Copy Link
      </button>
      <button
        onClick={openFullscreen}
        className="text-xs px-3 py-1 rounded-md border border-border hover:bg-muted transition-colors"
        title="Open full screen"
      >
        Fullscreen
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Create `apps/web/src/app/(app)/canvas/[jobId]/page.tsx`**

```tsx
import { CanvasFrame } from "@/components/canvas/CanvasFrame";
import { CanvasToolbar } from "@/components/canvas/CanvasToolbar";

type Props = { params: Promise<{ jobId: string }> };

export default async function CanvasViewPage({ params }: Props) {
  const { jobId } = await params;
  const sandboxOrigin = process.env.NEXT_PUBLIC_SANDBOX_ORIGIN ?? "http://localhost:5050";
  const src = `${sandboxOrigin}/canvas/serve/${jobId}/index.html`;

  return (
    <div className="flex flex-col h-full">
      <CanvasToolbar
        jobId={jobId}
        src={src}
        onReload={() => {}}   // client-side reload handled via key prop in real impl
      />
      <div className="flex-1 p-4">
        <CanvasFrame jobId={jobId} src={src} className="h-full min-h-[480px]" />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `apps/web/src/app/(app)/canvas/page.tsx`**

```tsx
export default function CanvasGalleryPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Canvas</h1>
      <p className="text-muted-foreground mb-8">
        Interactive slides, mind maps, and cheat sheets generated by the Code Agent.
      </p>
      {/* TODO: fetch recent canvas jobs from API and render as cards */}
      <p className="text-sm text-muted-foreground">No canvases yet. Use a canvas template to generate one.</p>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/canvas/ apps/web/src/app/\(app\)/canvas/
git commit -m "feat(web): sandboxed iframe canvas renderer with postMessage communication"
```

---

### Task 5: Code Agent (LangGraph)

**Files:**
- Create: `apps/api/src/agents/code/state.ts`
- Create: `apps/api/src/agents/code/nodes/generate-code.ts`
- Create: `apps/api/src/agents/code/nodes/execute-code.ts`
- Create: `apps/api/src/agents/code/nodes/analyze-result.ts`
- Create: `apps/api/src/agents/code/nodes/build-canvas.ts`
- Create: `apps/api/src/agents/code/graph.ts`
- Create: `apps/api/src/agents/code/index.ts`
- Create: `apps/api/src/routes/code-agent.ts`
- Edit: `apps/api/src/app.ts` (mount code agent router)

- [ ] **Step 1: Create `apps/api/src/agents/code/state.ts`**

```typescript
import { Annotation } from "@langchain/langgraph";

export type CodeLanguage = "python" | "javascript" | "react";

export const CodeAgentState = Annotation.Root({
  // inputs
  userId: Annotation<string>(),
  prompt: Annotation<string>(),
  language: Annotation<CodeLanguage>(),
  context: Annotation<string>({ default: () => "" }),       // optional note/concept context

  // iteration
  generatedSource: Annotation<string | null>({ default: () => null }),
  iterationCount: Annotation<number>({ default: () => 0 }),
  maxIterations: Annotation<number>({ default: () => 3 }),

  // execution result
  executionJobId: Annotation<string | null>({ default: () => null }),
  stdout: Annotation<string | null>({ default: () => null }),
  stderr: Annotation<string | null>({ default: () => null }),
  exitCode: Annotation<number | null>({ default: () => null }),

  // analysis
  analysisNote: Annotation<string | null>({ default: () => null }),
  shouldRetry: Annotation<boolean>({ default: () => false }),
  executionSuccess: Annotation<boolean>({ default: () => false }),

  // canvas
  canvasJobId: Annotation<string | null>({ default: () => null }),
  canvasUrl: Annotation<string | null>({ default: () => null }),
  isCanvasMode: Annotation<boolean>({ default: () => false }),
});

export type CodeAgentStateType = typeof CodeAgentState.State;
```

- [ ] **Step 2: Create `apps/api/src/agents/code/nodes/generate-code.ts`**

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CodeAgentStateType } from "../state";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  python: "Write clean Python 3 code. Do not use input(). Print all outputs with print().",
  javascript: "Write modern ESM JavaScript. Use console.log() for output. Do not use require().",
  react: "Write a single default-exported React functional component as TSX. Import React from 'react'. Use Tailwind CSS classes for styling. Do not import external libraries beyond react.",
};

export async function generateCodeNode(
  state: CodeAgentStateType
): Promise<Partial<CodeAgentStateType>> {
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });

  const languageGuide = LANGUAGE_INSTRUCTIONS[state.language] ?? "";
  const retryContext =
    state.iterationCount > 0 && state.stderr
      ? `\n\nPrevious attempt failed with this error:\n${state.stderr}\n\nFix the error in your new version.`
      : "";

  const prompt = `
You are an expert programmer. Generate code for the following request.

Language: ${state.language}
${languageGuide}

Request: ${state.prompt}

${state.context ? `Context from user's notes:\n${state.context}` : ""}
${retryContext}

Return ONLY the source code — no markdown fences, no explanations.
  `.trim();

  const result = await model.generateContent(prompt);
  const source = result.response.text().trim();

  // Strip accidental markdown code fences
  const stripped = source
    .replace(/^```[\w]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

  return {
    generatedSource: stripped,
    iterationCount: state.iterationCount + 1,
    isCanvasMode: state.language === "react",
  };
}
```

- [ ] **Step 3: Create `apps/api/src/agents/code/nodes/execute-code.ts`**

```typescript
import type { CodeAgentStateType } from "../state";

const SANDBOX_URL = process.env.SANDBOX_URL ?? "http://localhost:5050";

export async function executeCodeNode(
  state: CodeAgentStateType
): Promise<Partial<CodeAgentStateType>> {
  if (!state.generatedSource || state.isCanvasMode) return {};

  const res = await fetch(`${SANDBOX_URL}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language: state.language,
      source: state.generatedSource,
    }),
  });

  if (!res.ok) {
    return {
      stderr: `Sandbox API error: ${res.status}`,
      exitCode: -1,
      executionSuccess: false,
    };
  }

  const job = await res.json();
  return {
    executionJobId: job.id,
    stdout: job.stdout,
    stderr: job.stderr,
    exitCode: job.exitCode,
    executionSuccess: job.exitCode === 0,
  };
}
```

- [ ] **Step 4: Create `apps/api/src/agents/code/nodes/analyze-result.ts`**

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import type { CodeAgentStateType } from "../state";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const analysisSchema = z.object({
  success: z.boolean(),
  note: z.string(),
  shouldRetry: z.boolean(),
});

export async function analyzeResultNode(
  state: CodeAgentStateType
): Promise<Partial<CodeAgentStateType>> {
  // Canvas mode skips execution analysis
  if (state.isCanvasMode) return { executionSuccess: true, shouldRetry: false };

  if (state.executionSuccess) {
    return { analysisNote: "Execution succeeded.", shouldRetry: false };
  }

  if (state.iterationCount >= state.maxIterations) {
    return {
      analysisNote: "Max retries reached. Returning last attempt.",
      shouldRetry: false,
    };
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite-preview",
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `
Analyze this code execution failure and decide whether it is retryable.

Code:
${state.generatedSource}

Stderr:
${state.stderr}

Stdout (partial): ${state.stdout?.slice(0, 500) ?? ""}

Return JSON: { "success": false, "note": "brief diagnosis", "shouldRetry": true|false }
Retry only if the error is a fixable code bug (syntax error, name error, logic error).
Do NOT retry on resource limits, missing external dependencies, or network errors.
  `.trim();

  const result = await model.generateContent(prompt);
  const parsed = analysisSchema.parse(JSON.parse(result.response.text()));

  return {
    analysisNote: parsed.note,
    shouldRetry: parsed.shouldRetry,
  };
}
```

- [ ] **Step 5: Create `apps/api/src/agents/code/nodes/build-canvas.ts`**

```typescript
import type { CodeAgentStateType } from "../state";

const SANDBOX_URL = process.env.SANDBOX_URL ?? "http://localhost:5050";

export async function buildCanvasNode(
  state: CodeAgentStateType
): Promise<Partial<CodeAgentStateType>> {
  if (!state.isCanvasMode || !state.generatedSource) return {};

  // Submit build job
  const buildRes = await fetch(`${SANDBOX_URL}/canvas/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: state.generatedSource }),
  });

  if (!buildRes.ok) {
    return { canvasUrl: null };
  }

  const { jobId } = await buildRes.json();

  // Poll for completion (max 30 s)
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const pollRes = await fetch(`${SANDBOX_URL}/canvas/${jobId}`);
    if (!pollRes.ok) continue;
    const job = await pollRes.json();
    if (job.status === "completed") {
      const serveUrl = `${SANDBOX_URL}/canvas/serve/${jobId}/index.html`;
      return { canvasJobId: jobId, canvasUrl: serveUrl, executionSuccess: true };
    }
    if (job.status === "failed") {
      return { canvasJobId: jobId, canvasUrl: null, stderr: job.buildError };
    }
  }

  return { canvasUrl: null, stderr: "Canvas build timed out" };
}
```

- [ ] **Step 6: Create `apps/api/src/agents/code/graph.ts`**

```typescript
import { StateGraph, END } from "@langchain/langgraph";
import { CodeAgentState } from "./state";
import { generateCodeNode } from "./nodes/generate-code";
import { executeCodeNode } from "./nodes/execute-code";
import { analyzeResultNode } from "./nodes/analyze-result";
import { buildCanvasNode } from "./nodes/build-canvas";

const graph = new StateGraph(CodeAgentState)
  .addNode("generateCode", generateCodeNode)
  .addNode("executeCode", executeCodeNode)
  .addNode("analyzeResult", analyzeResultNode)
  .addNode("buildCanvas", buildCanvasNode)
  .addEdge("__start__", "generateCode")
  .addConditionalEdges("generateCode", (state) => {
    if (state.isCanvasMode) return "buildCanvas";
    return "executeCode";
  })
  .addEdge("executeCode", "analyzeResult")
  .addConditionalEdges("analyzeResult", (state) => {
    if (state.shouldRetry && state.iterationCount < state.maxIterations) {
      return "generateCode";   // retry loop
    }
    return END;
  })
  .addEdge("buildCanvas", END);

export const codeAgentGraph = graph.compile();
```

- [ ] **Step 7: Create `apps/api/src/agents/code/index.ts`**

```typescript
export { codeAgentGraph } from "./graph";
export type { CodeAgentStateType, CodeLanguage } from "./state";
```

- [ ] **Step 8: Create `apps/api/src/routes/code-agent.ts`**

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { codeAgentGraph } from "../agents/code";

export const codeAgentRouter = new Hono();
codeAgentRouter.use("*", authMiddleware);

const runSchema = z.object({
  prompt: z.string().min(1).max(4000),
  language: z.enum(["python", "javascript", "react"]),
  context: z.string().max(8000).optional(),
  maxIterations: z.number().int().min(1).max(5).optional(),
});

codeAgentRouter.post("/run", zValidator("json", runSchema), async (c) => {
  const userId = c.get("userId") as string;
  const body = c.req.valid("json");

  const result = await codeAgentGraph.invoke({
    userId,
    prompt: body.prompt,
    language: body.language,
    context: body.context ?? "",
    maxIterations: body.maxIterations ?? 3,
  });

  return c.json({
    source: result.generatedSource,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    executionSuccess: result.executionSuccess,
    analysisNote: result.analysisNote,
    iterations: result.iterationCount,
    // canvas-specific
    canvasJobId: result.canvasJobId,
    canvasUrl: result.canvasUrl,
    isCanvasMode: result.isCanvasMode,
  });
});
```

- [ ] **Step 9: Mount code agent router in `apps/api/src/app.ts`**

```typescript
import { codeAgentRouter } from "./routes/code-agent";
// inside app route mounting:
app.route("/api/code", codeAgentRouter);
```

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/agents/code/ apps/api/src/routes/code-agent.ts apps/api/src/app.ts
git commit -m "feat(api): Code Agent with LangGraph (generate → execute → analyze → retry loop + React canvas build)"
```

---

### Task 6: Canvas Template Integration

**Files:**
- Create: `apps/api/src/routes/canvas-templates.ts`
- Edit: `apps/api/src/app.ts` (mount canvas-templates router)

This task wires the canvas-renderer templates (slides, mindmap, cheatsheet) from `@opencairn/templates` through the Code Agent pipeline: template engine renders the prompt → Gemini produces structured JSON → Code Agent generates a React component from that JSON → canvas builder builds it → frontend renders the iframe URL.

- [ ] **Step 1: Create `apps/api/src/routes/canvas-templates.ts`**

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { loadTemplate, renderPrompt, validateOutput } from "@opencairn/templates";
import { codeAgentGraph } from "../agents/code";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
export const canvasTemplatesRouter = new Hono();
canvasTemplatesRouter.use("*", authMiddleware);

const CANVAS_TEMPLATE_IDS = ["slides", "mindmap", "cheatsheet"] as const;
type CanvasTemplateId = (typeof CANVAS_TEMPLATE_IDS)[number];

const runCanvasSchema = z.object({
  templateId: z.enum(CANVAS_TEMPLATE_IDS),
  variables: z.record(z.string()),
});

/**
 * Build a React component generation prompt from the structured canvas data.
 * The Code Agent will use this to produce the actual JSX.
 */
function buildReactPrompt(templateId: CanvasTemplateId, data: unknown): string {
  const dataJson = JSON.stringify(data, null, 2);
  const guides: Record<CanvasTemplateId, string> = {
    slides: `Create a React slide deck component. Render each slide full-width with a heading and bullet points. Add prev/next navigation buttons with state. Style with Tailwind CSS. Here is the slide data:\n${dataJson}`,
    mindmap: `Create a React mind map component. Render nodes as nested <ul>/<li> elements with indentation and colored dots per depth level. Style with Tailwind CSS. Here is the node tree data:\n${dataJson}`,
    cheatsheet: `Create a React cheat sheet component. Render each section as a card with a heading and a table of term/definition/example rows. Style with Tailwind CSS for a compact reference layout. Here is the cheat sheet data:\n${dataJson}`,
  };
  return guides[templateId];
}

canvasTemplatesRouter.post(
  "/run",
  zValidator("json", runCanvasSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const { templateId, variables } = c.req.valid("json");

    // 1. Load template + render prompt
    const template = loadTemplate(templateId);
    const prompt = renderPrompt(template, variables);

    // 2. Call Gemini to get structured data
    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite-preview",
      generationConfig: { responseMimeType: "application/json" },
    });
    const geminiResult = await model.generateContent(prompt);
    const rawJson = JSON.parse(geminiResult.response.text());

    // 3. Validate against Zod schema
    const structuredData = validateOutput(template, rawJson);

    // 4. Build React component prompt from structured data
    const reactPrompt = buildReactPrompt(templateId, structuredData);

    // 5. Run Code Agent in react mode → canvas build
    const agentResult = await codeAgentGraph.invoke({
      userId,
      prompt: reactPrompt,
      language: "react",
      context: "",
      maxIterations: 2,
    });

    return c.json({
      templateId,
      structuredData,
      canvasJobId: agentResult.canvasJobId,
      canvasUrl: agentResult.canvasUrl,
      source: agentResult.generatedSource,
      success: agentResult.executionSuccess,
    });
  }
);

// GET /canvas-templates — list available canvas templates
canvasTemplatesRouter.get("/", (c) => {
  return c.json(
    CANVAS_TEMPLATE_IDS.map((id) => {
      const t = loadTemplate(id);
      return { id: t.id, name: t.name, description: t.description, renderer: t.renderer };
    })
  );
});
```

- [ ] **Step 2: Mount canvas-templates router in `apps/api/src/app.ts`**

```typescript
import { canvasTemplatesRouter } from "./routes/canvas-templates";
// inside app route mounting:
app.route("/api/canvas-templates", canvasTemplatesRouter);
```

- [ ] **Step 3: Add `SANDBOX_URL` and `NEXT_PUBLIC_SANDBOX_ORIGIN` to `.env.example`**

Open `.env.example` and append:

```env
# Sandbox service
SANDBOX_URL=http://localhost:5050
NEXT_PUBLIC_SANDBOX_ORIGIN=http://localhost:5050
CANVAS_BUILDS_DIR=/app/canvas-builds
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/canvas-templates.ts apps/api/src/app.ts .env.example
git commit -m "feat(api): canvas template integration — template engine → Gemini → Code Agent → Vite build → iframe URL"
```

---

## Summary

| Task | Key Deliverable |
|------|----------------|
| 1 | `services/sandbox/` — Dockerfile (gVisor-ready), Express service, job store, execution limits |
| 2 | `/execute` routes — Python (`python3 -c`) and JS (`node --input-type=module`) with output size caps |
| 3 | `/canvas/build` + `/canvas/serve` — Vite programmatic build, static file serving per jobId |
| 4 | `CanvasFrame` + `CanvasToolbar` — sandboxed iframe with `postMessage` hook, reload/fullscreen/copy |
| 5 | Code Agent (LangGraph) — generate → execute → analyze → retry loop; React mode routes to canvas builder |
| 6 | Canvas template route — template engine + Gemini → structured JSON → Code Agent → React → Vite → iframe URL |
