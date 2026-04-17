# Plan 7: Canvas & Sandbox — Implementation Plan (Browser-First, 2026-04-14)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **2026-04-14 재작성:** 본 plan은 이전의 gVisor 기반 서버 사이드 샌드박스 구현을 완전히 폐기한 버전이다.
> - 구 Task 1~3 (gVisor Dockerfile, 서버 execute/canvas 라우트, Vite builder) → 전부 제거
> - 신 Task A~E: 브라우저 Pyodide 런타임 + iframe sandbox 렌더러 + Code Agent (Python 워커, 생성 전용) + 템플릿 통합
> - 근거: [ADR-006](../../architecture/adr/006-pyodide-iframe-sandbox.md)

**Goal:** OpenCairn의 Canvas & Sandbox 시스템을 **브라우저 전용 실행 환경**으로 구축한다. Python은 Pyodide(WASM), JS/HTML/React는 `<iframe sandbox="allow-scripts">` + esm.sh로 실행. Code Agent(Python worker)는 코드 **생성**만 담당하고, 실행은 전부 사용자 브라우저가 책임진다.

**Architecture:**

```
Code Agent (apps/worker, LangGraph)
    -> LLM이 코드 문자열 생성 (Python or React/JS/HTML)
    -> Hono API가 SSE로 프론트에 스트리밍 (type, language, source)
    -> 브라우저 (Next.js)
        * Python: <PyodideRunner> — pyodide.runPythonAsync, setStdin, stdout 수집
        * React/JS/HTML: <CanvasFrame> — Blob URL + iframe sandbox + esm.sh ESM CDN
    -> 사용자 인터랙션 / 실행 결과
    -> postMessage (origin 검증) → 부모 윈도우 → API → Agent self-healing
```

**Tech Stack:** Next.js 16, Hono 4, Pyodide 0.27+ (npm `pyodide`), esm.sh (런타임 ESM CDN), LangGraph (Python, Code Agent only), Zod, Tailwind CSS 4.

**핵심 설계 원칙:**
- 서버는 코드를 한 줄도 실행하지 않는다 (Pyodide/iframe 모두 client-side)
- 단일 사용자 모델 — multi-tenant 격리 불필요 (본인 에이전트 ↔ 본인 브라우저)
- `allow-same-origin`은 절대 iframe에 부여하지 않는다 (MDN 경고 — sandbox 탈출 가능)
- Pyodide 블로킹 `input()` 미지원 — stdin은 `setStdin()` pre-injection 배열만
- 테스트는 Playwright로 브라우저 내부 Pyodide 검증 (상세: `docs/testing/sandbox-testing.md`)

---

## File Structure

```
apps/
  web/
    src/
      components/
        canvas/
          PyodideRunner.tsx           -- WASM Python 실행, stdin pre-injection, stdout/matplotlib 수집
          CanvasFrame.tsx             -- <iframe sandbox="allow-scripts"> 렌더러
          CanvasToolbar.tsx           -- reload, copy-source, fullscreen
          useCanvasMessages.ts        -- postMessage + origin 검증 훅
          sandbox-html-template.ts    -- iframe 내부에 주입할 HTML shell (esm.sh import map)
      app/
        (app)/
          canvas/
            page.tsx                  -- 최근 canvas 갤러리
            [sessionId]/
              page.tsx                -- 특정 canvas 뷰 (source + 실행 결과)
      lib/
        pyodide-loader.ts             -- lazy load, 캐시, 버전 고정

  api/
    src/
      routes/
        code.ts                       -- POST /api/code/run (생성 전용)
        canvas.ts                     -- POST /api/canvas/from-template
      agents/                         -- (선택) TS 쪽 얇은 래퍼

  worker/
    src/worker/
      agents/
        code/
          __init__.py
          state.py                    -- CodeAgentState (LangGraph)
          nodes/
            generate.py               -- LLM → 코드 문자열
            analyze_feedback.py       -- stdout/에러 수신 후 retry 판단
          graph.py                    -- 상태 그래프 wiring

packages/
  shared/
    src/
      canvas.ts                       -- Zod: CanvasMessage, CodeLanguage, 공유 타입
```

---

### Task A: Pyodide 런타임 컴포넌트 (apps/web)

**Files:**
- Create: `apps/web/src/lib/pyodide-loader.ts`
- Create: `apps/web/src/components/canvas/PyodideRunner.tsx`

- [ ] **Step A1: `pyodide-loader.ts` — lazy load, 버전 고정**

```typescript
// apps/web/src/lib/pyodide-loader.ts
// Pyodide를 브라우저에서 한 번만 로드하고 캐시한다.
// CDN 버전은 고정 — 보안상 floating "latest" 금지.
import type { PyodideInterface } from "pyodide";

const PYODIDE_VERSION = "0.27.0";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let _instance: Promise<PyodideInterface> | null = null;

export function loadPyodide(): Promise<PyodideInterface> {
  if (_instance) return _instance;

  _instance = (async () => {
    // @ts-expect-error — loadPyodide는 CDN 스크립트에서 window에 주입됨
    const script = document.createElement("script");
    script.src = `${PYODIDE_CDN}pyodide.js`;
    script.async = true;
    await new Promise<void>((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Pyodide script"));
      document.head.appendChild(script);
    });

    // @ts-expect-error global injection
    const pyodide = await window.loadPyodide({ indexURL: PYODIDE_CDN });

    // 기본 번들만 로드. numpy/pandas/matplotlib은 필요 시 micropip로.
    return pyodide as PyodideInterface;
  })();

  return _instance;
}
```

- [ ] **Step A2: `PyodideRunner.tsx` — stdin 배열 주입 + stdout 수집 + matplotlib 이미지**

```tsx
// apps/web/src/components/canvas/PyodideRunner.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { loadPyodide } from "@/lib/pyodide-loader";

const EXECUTION_TIMEOUT_MS = 10_000;

type Props = {
  source: string;
  stdin?: string; // 사용자가 미리 붙여넣은 stdin 배열 (개행 구분)
  onResult?: (r: { stdout: string; stderr: string; timedOut: boolean }) => void;
};

export function PyodideRunner({ source, stdin = "", onResult }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "running" | "done" | "error">("loading");
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const pyodide = await loadPyodide();
        if (cancelled) return;
        setStatus("ready");

        // stdin pre-injection
        const lines = stdin.split("\n");
        let idx = 0;
        pyodide.setStdin({ stdin: () => (idx < lines.length ? lines[idx++] : null) });

        // stdout/stderr redirect
        let outBuf = "";
        let errBuf = "";
        pyodide.setStdout({ batched: (s: string) => { outBuf += s + "\n"; setStdout(outBuf); } });
        pyodide.setStderr({ batched: (s: string) => { errBuf += s + "\n"; setStderr(errBuf); } });

        setStatus("running");
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        const execPromise = pyodide.runPythonAsync(source);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), EXECUTION_TIMEOUT_MS)
        );

        try {
          await Promise.race([execPromise, timeoutPromise]);
          setStatus("done");
          onResult?.({ stdout: outBuf, stderr: errBuf, timedOut: false });
        } catch (e) {
          const timedOut = (e as Error).message === "TIMEOUT";
          setStatus(timedOut ? "error" : "error");
          setStderr((prev) => prev + "\n" + (e as Error).message);
          onResult?.({ stdout: outBuf, stderr: errBuf + "\n" + (e as Error).message, timedOut });
        }
      } catch (e) {
        setStatus("error");
        setStderr(String(e));
      }
    })();

    return () => { cancelled = true; };
  }, [source, stdin, onResult]);

  return (
    <div className="rounded-xl border bg-background p-4 space-y-2">
      <div className="text-xs text-muted-foreground">Pyodide: {status}</div>
      {stdout && <pre className="text-sm whitespace-pre-wrap font-mono">{stdout}</pre>}
      {stderr && <pre className="text-sm whitespace-pre-wrap font-mono text-destructive">{stderr}</pre>}
    </div>
  );
}
```

- [ ] **Step A3: Commit**

```bash
git add apps/web/src/lib/pyodide-loader.ts apps/web/src/components/canvas/PyodideRunner.tsx
git commit -m "feat(canvas): Pyodide runtime loader and Python runner with stdin pre-injection"
```

---

### Task B: Iframe Sandbox Renderer (apps/web)

**Files:**
- Create: `apps/web/src/components/canvas/sandbox-html-template.ts`
- Create: `apps/web/src/components/canvas/useCanvasMessages.ts`
- Create: `apps/web/src/components/canvas/CanvasFrame.tsx`

- [ ] **Step B1: `sandbox-html-template.ts` — iframe 내부 HTML 템플릿 + esm.sh import map**

```typescript
// apps/web/src/components/canvas/sandbox-html-template.ts
// 사용자 코드를 감싸는 최소 HTML shell. esm.sh로 React를 import.
export function buildSandboxHTML(userSource: string, language: "react" | "html" | "javascript"): string {
  if (language === "html") {
    return userSource; // 이미 완전한 HTML
  }

  if (language === "javascript") {
    return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body>
  <div id="root"></div>
  <script type="module">
${userSource}
  </script>
</body></html>`;
  }

  // React: esm.sh에서 React/ReactDOM import, 사용자 컴포넌트 mount
  return `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <script type="importmap">
    {
      "imports": {
        "react": "https://esm.sh/react@19",
        "react-dom/client": "https://esm.sh/react-dom@19/client"
      }
    }
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from "react";
    import { createRoot } from "react-dom/client";
    ${userSource}
    // 사용자 코드는 export default를 제공한다고 가정
    const container = document.getElementById("root");
    createRoot(container).render(React.createElement(App ?? (typeof default_1 !== "undefined" ? default_1 : null)));
  </script>
</body></html>`;
}
```

- [ ] **Step B2: `useCanvasMessages.ts` — postMessage + origin 검증**

```typescript
// apps/web/src/components/canvas/useCanvasMessages.ts
"use client";
import { useEffect, useRef, useCallback } from "react";

export type CanvasMessage =
  | { type: "CANVAS_READY" }
  | { type: "CANVAS_ERROR"; error: string }
  | { type: "CANVAS_RESIZE"; height: number }
  | { type: "HOST_THEME"; theme: "light" | "dark" };

// Blob URL의 origin은 null로 보고되므로 event.origin === "null"이어야 한다.
// 동시에 iframe contentWindow 참조로 추가 검증 (MessageEvent source 비교).
export function useCanvasMessages(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  onMessage: (m: CanvasMessage) => void
) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    function listener(event: MessageEvent) {
      // Blob: URL iframe은 origin이 "null"로 보고됨
      if (event.origin !== "null") return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      handlerRef.current(event.data as CanvasMessage);
    }
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [iframeRef]);

  const send = useCallback((m: CanvasMessage) => {
    // Blob URL origin은 불안정 → 이곳에서는 별도 채널이 필요하면 MessageChannel 권장
    iframeRef.current?.contentWindow?.postMessage(m, "*");
  }, [iframeRef]);

  return { send };
}
```

- [ ] **Step B3: `CanvasFrame.tsx` — Blob URL + sandbox 속성**

```tsx
// apps/web/src/components/canvas/CanvasFrame.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildSandboxHTML } from "./sandbox-html-template";
import { useCanvasMessages } from "./useCanvasMessages";

type Props = {
  source: string;
  language: "react" | "html" | "javascript";
  className?: string;
};

const MAX_SOURCE_BYTES = 64 * 1024;

export function CanvasFrame({ source, language, className = "" }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(480);

  const blobUrl = useMemo(() => {
    if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
      setError(`Source exceeds ${MAX_SOURCE_BYTES} bytes`);
      return null;
    }
    const html = buildSandboxHTML(source, language);
    const blob = new Blob([html], { type: "text/html" });
    return URL.createObjectURL(blob);
  }, [source, language]);

  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  useCanvasMessages(iframeRef, (m) => {
    if (m.type === "CANVAS_ERROR") setError(m.error);
    if (m.type === "CANVAS_RESIZE") setHeight(m.height);
  });

  if (!blobUrl) return <div className="p-4 text-destructive">{error}</div>;

  return (
    <div className={`rounded-xl overflow-hidden border bg-background ${className}`}>
      <iframe
        ref={iframeRef}
        src={blobUrl}
        title="OpenCairn Canvas"
        // CRITICAL: allow-same-origin 절대 추가 금지 (sandbox escape 가능, MDN 경고)
        sandbox="allow-scripts"
        style={{ height, width: "100%", border: 0 }}
        loading="lazy"
      />
      {error && <div className="p-2 text-sm text-destructive bg-destructive/10">{error}</div>}
    </div>
  );
}
```

- [ ] **Step B4: Commit**

```bash
git add apps/web/src/components/canvas/
git commit -m "feat(canvas): iframe sandbox renderer with Blob URL and postMessage origin guard"
```

---

### Task C: Code Agent (Python worker, LangGraph)

**Files:**
- Create: `apps/worker/src/worker/agents/code/state.py`
- Create: `apps/worker/src/worker/agents/code/nodes/generate.py`
- Create: `apps/worker/src/worker/agents/code/nodes/analyze_feedback.py`
- Create: `apps/worker/src/worker/agents/code/graph.py`

- [ ] **Step C1: `state.py`**

```python
# apps/worker/src/worker/agents/code/state.py
from dataclasses import dataclass, field
from typing import Literal

CodeLanguage = Literal["python", "javascript", "html", "react"]


@dataclass
class CodeAgentState:
    user_id: str
    prompt: str
    language: CodeLanguage
    context: str = ""

    generated_source: str | None = None
    iteration: int = 0
    max_iterations: int = 3

    # 클라이언트에서 온 피드백
    client_stdout: str | None = None
    client_stderr: str | None = None
    client_timed_out: bool = False

    should_retry: bool = False
    analysis_note: str = ""
```

- [ ] **Step C2: `nodes/generate.py` — get_provider() 사용**

```python
# apps/worker/src/worker/agents/code/nodes/generate.py
from llm import get_provider
from ..state import CodeAgentState

GUIDES = {
    "python": (
        "Write clean Python 3 for Pyodide (browser WASM). Use print() for output. "
        "Do NOT use blocking input(); stdin is pre-injected as an array. "
        "Avoid native C extensions not in Pyodide's wheel list."
    ),
    "react": (
        "Write a single default-exported React functional component as an ES module. "
        "Import React from 'react' (served via esm.sh import map). "
        "Use Tailwind classes only; no CSS imports."
    ),
    "javascript": "Write an ES module. Use console.log for output. No require().",
    "html": "Write complete, self-contained HTML. Inline CSS/JS OK.",
}


async def generate_code(state: CodeAgentState) -> CodeAgentState:
    provider = get_provider()
    retry = (
        f"\n\nPrevious attempt stderr:\n{state.client_stderr}\n\nFix the bug."
        if state.iteration > 0 and state.client_stderr
        else ""
    )
    prompt = (
        f"You are an expert programmer. Generate code.\n\n"
        f"Language: {state.language}\n{GUIDES[state.language]}\n\n"
        f"Request: {state.prompt}\n\n"
        f"{('Context:\\n' + state.context) if state.context else ''}"
        f"{retry}\n\n"
        "Return ONLY the source — no markdown fences, no explanations."
    )
    result = await provider.generate([{"role": "user", "content": prompt}])
    # strip accidental fences
    src = result.strip().removeprefix("```").removeprefix("python").removeprefix("tsx").removeprefix("\n")
    src = src.rstrip("`").rstrip()
    state.generated_source = src
    state.iteration += 1
    return state
```

- [ ] **Step C3: `nodes/analyze_feedback.py`**

```python
# apps/worker/src/worker/agents/code/nodes/analyze_feedback.py
from ..state import CodeAgentState

async def analyze_feedback(state: CodeAgentState) -> CodeAgentState:
    if state.client_stderr is None and state.client_stdout is not None:
        state.should_retry = False
        state.analysis_note = "Execution reported success by client."
        return state

    if state.iteration >= state.max_iterations:
        state.should_retry = False
        state.analysis_note = "Max iterations reached."
        return state

    # 간단한 휴리스틱: Python NameError/SyntaxError/TypeError → retry
    err = state.client_stderr or ""
    retryable = any(
        m in err for m in ("SyntaxError", "NameError", "TypeError", "IndentationError")
    )
    state.should_retry = retryable
    state.analysis_note = ("Retryable code error" if retryable else "Non-retryable or external failure.")
    return state
```

- [ ] **Step C4: `graph.py`**

```python
# apps/worker/src/worker/agents/code/graph.py
from langgraph.graph import StateGraph, END
from .state import CodeAgentState
from .nodes.generate import generate_code
from .nodes.analyze_feedback import analyze_feedback


def build_code_agent():
    g = StateGraph(CodeAgentState)
    g.add_node("generate", generate_code)
    g.add_node("analyze", analyze_feedback)
    g.set_entry_point("generate")
    # generate 후 클라이언트 응답을 기다려야 하므로 분기 엔진은 외부에서 제어
    # 여기서는 "generate" → END 직결, 실행 이후 analyze를 별도 호출
    g.add_edge("generate", END)
    # analyze 후 retry 필요 시 다시 generate
    g.add_conditional_edges(
        "analyze",
        lambda s: "generate" if s.should_retry else END,
    )
    return g.compile()
```

- [ ] **Step C5: Commit**

```bash
git add apps/worker/src/worker/agents/code/
git commit -m "feat(worker): Code Agent LangGraph (generate-only + client feedback analysis)"
```

---

### Task D: API Endpoints (Hono) — 생성 전용

**Files:**
- Create: `apps/api/src/routes/code.ts`

- [ ] **Step D1: `POST /api/code/run` — Hono에서 worker의 code agent를 호출, 코드 문자열만 반환**

```typescript
// apps/api/src/routes/code.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { getTemporalClient } from "../lib/temporal-client";

const schema = z.object({
  prompt: z.string().min(1).max(4000),
  language: z.enum(["python", "javascript", "html", "react"]),
  context: z.string().max(8000).optional(),
});

export const codeRouter = new Hono().use("*", authMiddleware);

codeRouter.post("/run", zValidator("json", schema), async (c) => {
  const session = c.get("session");
  const body = c.req.valid("json");

  const client = await getTemporalClient();
  const handle = await client.workflow.start("CodeAgentWorkflow", {
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "default",
    workflowId: `code-${crypto.randomUUID()}`,
    args: [{ userId: session.userId, ...body }],
  });

  const result = await handle.result();
  return c.json({
    source: result.source,
    language: result.language,
    iteration: result.iteration,
  });
});

// 클라이언트가 브라우저 실행 후 결과를 보고할 때 (retry loop용)
codeRouter.post("/feedback", zValidator("json", z.object({
  workflowId: z.string(),
  stdout: z.string().nullable(),
  stderr: z.string().nullable(),
  timedOut: z.boolean(),
})), async (c) => {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(c.req.valid("json").workflowId);
  await handle.signal("clientFeedback", c.req.valid("json"));
  return c.json({ ok: true });
});
```

- [ ] **Step D2: Commit**

```bash
git add apps/api/src/routes/code.ts
git commit -m "feat(api): Code Agent endpoints (generate-only, client feedback signal)"
```

---

### Task E: Canvas Template Integration

**Files:**
- Create: `apps/api/src/routes/canvas.ts`
- Create: `apps/web/src/app/(app)/canvas/[sessionId]/page.tsx`

- [ ] **Step E1: `POST /api/canvas/from-template` — Plan 6의 canvas 템플릿(slides, mindmap, cheatsheet)을 Code Agent로 전환**

```typescript
// apps/api/src/routes/canvas.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { renderTemplate } from "@opencairn/templates";
import { getTemporalClient } from "../lib/temporal-client";

const schema = z.object({
  templateId: z.enum(["slides", "mindmap", "cheatsheet"]),
  variables: z.record(z.string()),
});

export const canvasRouter = new Hono().use("*", authMiddleware);

canvasRouter.post("/from-template", zValidator("json", schema), async (c) => {
  const session = c.get("session");
  const { templateId, variables } = c.req.valid("json");

  const prompt = renderTemplate(templateId, variables);
  const client = await getTemporalClient();
  const handle = await client.workflow.start("CodeAgentWorkflow", {
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "default",
    workflowId: `canvas-${templateId}-${crypto.randomUUID()}`,
    args: [{ userId: session.userId, prompt, language: "react" }],
  });

  const result = await handle.result();
  return c.json({ source: result.source, language: "react", templateId });
});
```

- [ ] **Step E2: `canvas/[sessionId]/page.tsx` — source를 CanvasFrame으로 렌더**

```tsx
// apps/web/src/app/(app)/canvas/[sessionId]/page.tsx
"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CanvasFrame } from "@/components/canvas/CanvasFrame";
import { PyodideRunner } from "@/components/canvas/PyodideRunner";

export default function CanvasSession() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { data } = useQuery({
    queryKey: ["canvas", sessionId],
    queryFn: async () => {
      const r = await fetch(`/api/canvas/sessions/${sessionId}`);
      return r.json() as Promise<{ source: string; language: "react" | "python" | "html" | "javascript" }>;
    },
  });

  if (!data) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      {data.language === "python" ? (
        <PyodideRunner source={data.source} />
      ) : (
        <CanvasFrame source={data.source} language={data.language} />
      )}
    </div>
  );
}
```

- [ ] **Step E3: Commit**

```bash
git add apps/api/src/routes/canvas.ts apps/web/src/app/\(app\)/canvas/
git commit -m "feat(canvas): template-to-canvas route and session page rendering"
```

---

## Limits & Guardrails

| 항목 | 값 |
|------|----|
| EXECUTION_TIMEOUT_MS (Pyodide) | 10,000 ms |
| MAX_SOURCE_BYTES (iframe/Pyodide) | 64 KB |
| MAX_CANVAS_BUNDLE_BYTES | N/A (런타임 CDN, 빌드 없음) |
| Code Agent max_iterations | 3 |
| Pyodide heap (Chrome 기본) | ~2 GB (브라우저가 관리, 무한루프는 Promise race로 중단) |
| esm.sh 허용 도메인 (CSP) | `https://esm.sh`, `https://cdn.jsdelivr.net/pyodide/` |
| iframe `sandbox` 속성 | `"allow-scripts"` ONLY (allow-same-origin 금지) |

## Security Checklist (ADR-006 + security-model.md 연동)

- [ ] CSP `frame-src` / `script-src` 화이트리스트에 esm.sh, jsdelivr pyodide 포함
- [ ] `iframe sandbox` 속성이 `allow-scripts`만 가지는지 단위 테스트
- [ ] `allow-same-origin`이 추가되면 Playwright 테스트 실패 (Task F의 E2E 테스트)
- [ ] `postMessage` origin은 `"null"`로 검증 (Blob URL)
- [ ] Pyodide 버전은 고정 (`PYODIDE_VERSION` 상수), floating tag 사용 금지
- [ ] Blob URL은 컴포넌트 언마운트 시 `URL.revokeObjectURL`

## Verification

- [ ] `pnpm --filter @opencairn/web dev` 후 `/canvas/demo`에서 Python 코드가 브라우저에서 실행되고 stdout이 표시됨
- [ ] React 컴포넌트를 iframe에서 렌더, 부모 창 쿠키/localStorage 접근 시도 시 DOMException
- [ ] Pyodide 10초 타임아웃 동작 확인 (`while True: pass` 주입)
- [ ] `allow-same-origin`을 수동 추가하면 E2E 테스트 실패
- [ ] Code Agent가 Python NameError 발생 시 self-healing 한 번 재생성, 2회째 성공
- [ ] 64KB 초과 소스는 거부되고 에러 UI 표시
- [ ] Blob URL 언마운트 후 `URL.revokeObjectURL` 호출됨 (memory leak 없음)

---

## Summary

| Task | Key Deliverable |
|------|----------------|
| A | Pyodide 런타임 loader + `<PyodideRunner>` (stdin pre-injection, 10s timeout, stdout/stderr 수집) |
| B | `<CanvasFrame>` (Blob URL + `sandbox="allow-scripts"`, postMessage origin 검증, esm.sh import map) |
| C | Code Agent (LangGraph, generate + analyze_feedback, max 3 iteration) |
| D | `/api/code/run` + `/api/code/feedback` Hono routes (생성 전용, 클라이언트 피드백 signal) |
| E | Canvas template-to-canvas endpoint + session 페이지 (Pyodide / iframe 분기) |

서버 자원 0. ARM 호환 100%. gVisor 의존성 0. Claude Artifacts / Gemini Canvas와 동일한 UX 패턴.
