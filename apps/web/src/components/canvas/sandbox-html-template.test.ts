import { describe, expect, it } from "vitest";
import { buildSandboxHTML } from "./sandbox-html-template";

describe("buildSandboxHTML", () => {
  it("html mode returns input verbatim", () => {
    const html = "<h1>hi</h1>";
    expect(buildSandboxHTML(html, "html")).toBe(html);
  });

  it("javascript mode wraps in <script type=module> with #root container", () => {
    const out = buildSandboxHTML("console.log('x');", "javascript");
    expect(out).toContain('<script type="module">');
    expect(out).toContain("console.log('x');");
    expect(out).toContain('<div id="root"></div>');
  });

  it("react mode emits esm.sh import map pinning react@19 + react-dom@19/client", () => {
    const out = buildSandboxHTML("export default function App() { return null; }", "react");
    expect(out).toContain('"react": "https://esm.sh/react@19"');
    expect(out).toContain('"react-dom/client": "https://esm.sh/react-dom@19/client"');
    expect(out).toContain("createRoot");
  });

  it("react mode pins versions (no floating 'latest' or unpinned react@)", () => {
    const out = buildSandboxHTML("x", "react");
    expect(out).not.toMatch(/esm\.sh\/react@(?!19)/);
    expect(out).not.toContain("latest");
  });

  describe("python mode", () => {
    const labels = {
      loading: "Loading Pyodide…",
      ready: "Ready",
      running: "Running…",
      done: "Done",
      error: "Error",
      timedOut: "Execution exceeded the 10-second timeout.",
    };

    it("loads Pyodide from a version-pinned CDN URL", () => {
      const out = buildSandboxHTML("print('x')", "python", {
        pythonLabels: labels,
      });
      expect(out).toContain("https://cdn.jsdelivr.net/pyodide/v0.27.0/full/");
      expect(out).not.toContain("latest");
    });

    it("embeds the user source as a JS string literal (JSON-encoded)", () => {
      const src = 'print("hello")';
      const out = buildSandboxHTML(src, "python", { pythonLabels: labels });
      // JSON.stringify("print(\"hello\")") → "print(\"hello\")" — interior
      // double-quotes get backslash-escaped so the surrounding JS literal
      // stays well-formed.
      expect(out).toContain('"print(\\"hello\\")"');
    });

    it("escapes </script> inside user source so it cannot break out of the script tag", () => {
      // Without the </ → <\/ replacement, this source would close the
      // surrounding <script type="module"> early and execute as HTML.
      const malicious = "x = '</script><img src=x onerror=alert(1)>'";
      const out = buildSandboxHTML(malicious, "python", {
        pythonLabels: labels,
      });
      expect(out).not.toContain("</script><img");
      expect(out).toContain("<\\/script>");
    });

    it("posts CANVAS_PYTHON_RESULT to parent on success and on timeout", () => {
      const out = buildSandboxHTML("1", "python", { pythonLabels: labels });
      // Two postParent sites: the success path and the timeout branch.
      const successCount = out.match(
        /CANVAS_PYTHON_RESULT/g,
      )?.length;
      expect(successCount).toBeGreaterThanOrEqual(2);
    });

    it("forces matplotlib backend to AGG before user code runs", () => {
      const out = buildSandboxHTML("1", "python", { pythonLabels: labels });
      expect(out).toContain("MPLBACKEND");
      expect(out).toContain("AGG");
    });

    it("uses provided localized labels", () => {
      const koLabels = {
        loading: "파이오다이드 로드 중…",
        ready: "준비됨",
        running: "실행 중…",
        done: "완료",
        error: "오류",
        timedOut: "10초 초과",
      };
      const out = buildSandboxHTML("1", "python", { pythonLabels: koLabels });
      expect(out).toContain("파이오다이드 로드 중");
      expect(out).toContain("실행 중");
    });

    it("falls back to English labels if pythonLabels is omitted", () => {
      const out = buildSandboxHTML("1", "python");
      expect(out).toContain("Loading Pyodide");
      expect(out).toContain("Running");
    });
  });
});
