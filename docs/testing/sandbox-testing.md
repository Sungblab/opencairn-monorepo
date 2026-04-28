# Browser Sandbox Testing

브라우저 안에서 실행되는 Pyodide (WASM Python) + iframe(`<iframe sandbox>`) 코드 실행 환경을 어떻게 CI에서 검증하는지 정리한다. [ADR-006](../architecture/adr/006-pyodide-iframe-sandbox.md)의 보안 경계가 실제로 유지되는지, Code Agent가 생성한 코드가 예상대로 동작하는지, LLM 응답이 회귀 없이 흐르는지가 핵심이다.

---

## 1. 레이어 구분

| 레이어 | 도구 | 타겟 |
|--------|------|------|
| Unit (순수 로직) | Vitest | `PyodideRunner` 훅, `useCanvasMessages`, `sandbox-html-template` 문자열 생성 |
| Component (렌더) | Vitest + `@testing-library/react` + jsdom | `<CanvasFrame>` props 변경 시 렌더링, Blob URL revoke |
| E2E (보안 경계) | Playwright | iframe sandbox 속성, postMessage origin, Pyodide 실제 실행 |
| Worker 단위 | pytest | Code Agent (`runtime.Agent` tool-use loop, `generate` / `analyze_feedback` 단계) |
| Agent golden | pytest + 고정 fixture | 프롬프트 → 코드 생성 스냅샷 비교 |

---

## 2. Unit 테스트

### 2.1 `sandbox-html-template` — 순수 문자열 생성

```ts
// apps/web/src/components/canvas/__tests__/sandbox-html-template.test.ts
import { buildSandboxHTML } from "../sandbox-html-template";

describe("buildSandboxHTML", () => {
  it("HTML 언어면 입력을 그대로 반환한다", () => {
    const html = "<h1>hi</h1>";
    expect(buildSandboxHTML(html, "html")).toBe(html);
  });

  it("React 모드는 import map에 react와 react-dom/client를 포함한다", () => {
    const out = buildSandboxHTML("export default () => null;", "react");
    expect(out).toContain('"react": "https://esm.sh/react@19"');
    expect(out).toContain('"react-dom/client": "https://esm.sh/react-dom@19/client"');
  });

  it("javascript 모드는 <script type=\"module\">로 감싼다", () => {
    const out = buildSandboxHTML("console.log('x');", "javascript");
    expect(out).toContain('<script type="module">');
  });
});
```

### 2.2 `useCanvasMessages` — origin 검증 로직

```ts
// jsdom window.postMessage 시뮬레이션
it("origin이 'null'이 아닌 message는 무시한다", () => {
  const onMsg = vi.fn();
  // ... render hook, dispatch MessageEvent with origin="https://evil.com"
  expect(onMsg).not.toHaveBeenCalled();
});
```

---

## 3. Component 테스트 (jsdom + testing-library)

### 3.1 `<CanvasFrame>` Blob URL 생명주기

```tsx
it("언마운트 시 URL.revokeObjectURL이 호출된다", () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const { unmount } = render(<CanvasFrame source="x" language="html" />);
  unmount();
  expect(revoke).toHaveBeenCalled();
});

it("source가 MAX_SOURCE_BYTES 초과면 에러를 표시한다", () => {
  const big = "a".repeat(70_000);
  const { getByText } = render(<CanvasFrame source={big} language="html" />);
  expect(getByText(/Source exceeds/i)).toBeInTheDocument();
});
```

### 3.2 `<PyodideRunner>` 로딩 상태

Pyodide 자체는 jsdom에서 동작 안 함(WASM + CDN). 여기서는 `@/lib/pyodide-loader`를 mock하고 "ready"/"error" 상태 전환만 검증.

---

## 4. E2E 테스트 (Playwright — 핵심)

브라우저가 실제로 Pyodide를 로드하고 iframe의 sandbox 속성이 강제되는지는 **실제 브라우저 없이 검증 불가능**. Playwright로 다음을 덮는다.

### 4.1 Pyodide 실행 & 타임아웃

```ts
// apps/web/tests/e2e/pyodide.spec.ts
test("Pyodide가 Python 코드를 실행하고 stdout을 스트리밍한다", async ({ page }) => {
  await page.goto("/canvas/demo?lang=python");
  await page.locator("textarea[name=source]").fill("for i in range(3): print(i)");
  await page.locator("button[type=submit]").click();
  await expect(page.locator("pre[data-testid=stdout]")).toHaveText(/0\n1\n2/, {
    timeout: 30_000, // 첫 로드 느림
  });
});

test("10초 EXECUTION_TIMEOUT_MS 초과 시 timedOut 상태가 된다", async ({ page }) => {
  await page.goto("/canvas/demo?lang=python");
  await page.locator("textarea[name=source]").fill("while True: pass");
  await page.locator("button[type=submit]").click();
  await expect(page.locator("[data-testid=status]")).toHaveText(/error/, { timeout: 15_000 });
  await expect(page.locator("pre[data-testid=stderr]")).toContainText(/TIMEOUT/);
});
```

### 4.2 iframe sandbox 격리 (ADR-006 핵심 검증)

```ts
test("iframe에서 부모의 document.cookie 접근 시 DOMException", async ({ page }) => {
  await page.goto("/canvas/demo?lang=html");
  await page.locator("textarea[name=source]").fill(`
    <script>
      try {
        const c = window.parent.document.cookie;
        parent.postMessage({ type: "LEAKED", data: c }, "*");
      } catch (e) {
        parent.postMessage({ type: "BLOCKED", error: String(e) }, "*");
      }
    </script>
  `);
  await page.locator("button[type=submit]").click();

  const message = await page.evaluate(() =>
    new Promise<unknown>((resolve) => {
      window.addEventListener("message", (e) => resolve(e.data), { once: true });
    })
  );
  expect((message as { type: string }).type).toBe("BLOCKED");
});

test("iframe의 sandbox 속성은 allow-scripts만 포함한다 (allow-same-origin 없음)", async ({ page }) => {
  await page.goto("/canvas/demo?lang=html");
  const sandbox = await page.locator("iframe").getAttribute("sandbox");
  expect(sandbox).toBe("allow-scripts");
});

test("postMessage의 origin이 'null'인 이벤트만 처리한다", async ({ page }) => {
  // window.postMessage를 가로채서 origin을 변조하는 스크립트 주입 시도
  // → 기대: event.origin !== "null" 이면 훅에서 무시
});
```

### 4.3 esm.sh 고정 버전 확인

```ts
test("Pyodide CDN은 고정 버전을 로드한다 (floating latest 금지)", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/canvas/demo?lang=python");
  // 로드 대기
  await page.waitForFunction(() => (window as any).loadPyodide);
  const pyodideRequests = requests.filter((u) => u.includes("/pyodide/"));
  expect(pyodideRequests.every((u) => u.match(/\/v\d+\.\d+\.\d+\//))).toBe(true);
});
```

### 4.4 CSP 위반

```ts
test("iframe이 허용되지 않은 origin에 fetch 시도 시 CSP가 차단", async ({ page }) => {
  await page.on("console", (msg) => {
    if (msg.text().includes("Content Security Policy")) {
      // CSP violation 로그 캡처
    }
  });
  // HTML 샌드박스 내 스크립트가 외부 도메인 fetch 시도 → CSP 차단 확인
});
```

---

## 5. Worker / Agent 테스트

### 5.1 Code Agent (`runtime.Agent`)

```python
# apps/worker/tests/agents/test_code_agent.py
import pytest
from worker.agents.code.agent import CodeAgent
from runtime.tools import ToolContext

@pytest.mark.asyncio
async def test_generate_strips_python_fences(monkeypatch):
    async def fake_generate(messages, **kw): return "```python\nprint('hi')\n```"
    monkeypatch.setattr("llm.get_provider", lambda: MagicMock(generate=fake_generate))
    agent = CodeAgent()
    ctx = ToolContext(workspace_id="w", project_id=None, page_id=None,
                      user_id="u", run_id="r", scope="project", emit=lambda _: None)
    events = [ev async for ev in agent.run({"prompt": "x", "language": "python"}, ctx)]
    end = next(ev for ev in events if ev.type == "agent_end")
    assert "```" not in end.output["generated_source"]
    assert "print('hi')" in end.output["generated_source"]
```

피드백 루프 분기는 별도 단계 함수가 아니라 agent 내부 tool-use 루프의 분기 — 트랜스크립트(trajectory) 이벤트로 검증한다.

### 5.2 Golden 스냅샷 (LLM 회귀)

**목적**: 프롬프트나 모델이 바뀌었을 때 이전 응답과의 diff를 확인. 절대 정확도가 아니라 **상대 회귀** 탐지.

**디렉토리 구조**:
```
apps/worker/tests/golden/
  code_agent/
    basic-python-fizzbuzz.prompt.txt     # 고정 입력
    basic-python-fizzbuzz.golden.py      # 기대 출력 (검증된 사람-리뷰된 스냅샷)
    react-counter.prompt.txt
    react-counter.golden.tsx
```

**실행 모드 2가지**:
- **기본 (CI)**: **mock** LLM 사용 (`tests/fixtures/code_agent_responses.json`에 저장된 응답 재생). 결정적, 무료, 빠름.
- **`PYTEST_LIVE_LLM=1`** (로컬·주간): 실제 Gemini 호출 → golden과 diff 리포트. score<80% 일치 시 실패.

**갱신 SOP**:
1. 모델 변경 (예: Flash-Lite → Flash-Pro) PR 생성
2. 로컬에서 `PYTEST_UPDATE_GOLDEN=1 pytest tests/golden/` 실행
3. `git diff`로 응답 변화 사람이 검토
4. 결과가 받아들일 만하면 새 golden 커밋, PR description에 diff 첨부
5. 갱신 주기: 모델 변경/프롬프트 변경 시. 정기적으로는 갱신 금지 (노이즈만 커짐)

---

## 6. CI 파이프라인에서의 구성

`.github/workflows/ci.yml` 에서 레이어별 잡 분리:

```yaml
jobs:
  web-unit:
    runs-on: ubuntu-latest
    steps:
      - pnpm --filter @opencairn/web test              # vitest
  web-e2e:
    runs-on: ubuntu-latest
    services: [postgres-test, redis, minio]
    steps:
      - pnpm build
      - pnpm playwright install --with-deps chromium
      - pnpm playwright test                            # E2E (Pyodide + iframe)
  worker-unit:
    steps:
      - cd apps/worker && pytest -m "not live_llm"
  worker-golden:
    # PR 라벨 "llm-change" 있을 때만
    if: contains(github.event.pull_request.labels.*.name, 'llm-change')
    env: { PYTEST_LIVE_LLM: "1" }
    steps:
      - pytest tests/golden/
```

**주의**:
- Playwright E2E는 Pyodide 최초 다운로드 때문에 첫 테스트 실행이 느리다 (~15s). 후속 테스트는 캐시로 빠름.
- GitHub Actions 러너에 Chromium + Pyodide 캐시 주입 (actions/cache로 `~/.cache/ms-playwright`, pyodide는 브라우저 캐시라 별도 주입 불필요).

---

## 7. 실패 시 트러블슈팅

| 증상 | 원인 후보 | 조치 |
|------|----------|------|
| Pyodide 로드 타임아웃 | CDN 응답 지연, 네트워크 막힘 | CI 재시도, `PYODIDE_VERSION` fallback CDN 추가 |
| iframe sandbox 속성 테스트 실패 | Next.js 코드에서 `allow-same-origin` 추가된 실수 | `grep -R "allow-same-origin" apps/web/src` 해서 즉시 회귀 차단 |
| postMessage origin 검증 실패 | `"*"` 와일드카드 사용 회귀 | `grep -R "postMessage.*, *\"\\*\"" apps/web/src` 체크 |
| Golden diff 100% mismatch | 모델 ID 변경/프롬프트 변경 | 의도한 변경이면 `PYTEST_UPDATE_GOLDEN=1` |
| Code Agent 무한 retry | `max_iterations` 조건 버그 | `apps/worker/src/worker/agents/code/nodes/analyze_feedback.py` 조건 확인 |

---

## 8. 회귀 가드레일 (PR 필수 체크)

- [ ] `grep -R "allow-same-origin" apps/web/src` → 0건
- [ ] `grep -R "postMessage.*\"\\*\"" apps/web/src` → 없거나 주석 처리됐는지
- [ ] Pyodide CDN에 floating `latest` 태그 없음 (`grep -R "pyodide/v@latest\\|pyodide/latest"`)
- [ ] `sandbox="allow-scripts"` 외 속성 추가 시 PR 설명에 근거

---

## 9. 변경 이력

- 2026-04-18: 최초 작성. ADR-006 적용 후 브라우저 샌드박스 전담 테스트 전략.
