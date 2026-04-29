// Renders the HTML string written into a Blob URL → iframe sandbox.
// All runtime CDN URLs are version-pinned (esm.sh react@19, pyodide
// v0.27.0) so a CDN drift can't silently change the React major or the
// Python wheel set. CI grep guard (Task 17) blocks `latest` / unpinned
// tags from regressing.
//
// Why four modes:
// - "html": user wrote HTML; render as-is.
// - "javascript": wrap user JS in a module script; provide a `#root` mount.
// - "react": same `#root`, but bring React via esm.sh import map and call
//   `createRoot(globalThis.App)` on the user's component.
// - "python": load Pyodide inside the iframe, run the user source under a
//   timeout, capture matplotlib figures, and post a CANVAS_PYTHON_RESULT
//   message back to the parent. Pyodide MUST run inside the cross-origin
//   Blob iframe (sandbox="allow-scripts" only, no allow-same-origin) — if
//   it ran in the main page realm, `from js import fetch, document,
//   localStorage` would expose the parent app's session-bound APIs to any
//   collaborator who plants Python in a shared canvas note. See ADR-006
//   and the 2026-04-29 frontend-security-audit Finding 3.
//
// Phase 1 React contract: the user assigns their component to
// `globalThis.App`, e.g. `globalThis.App = function App() { return ... }`.
// `export default` does NOT work inside an inline `<script type="module">`
// because the script has no module specifier — its exports are unreachable.
// Phase 2 will support `export default` via dynamic `import()` of the user's
// source as a separate Blob URL module; until then, `globalThis.App` is the
// supported pattern and the runner surfaces a clear error otherwise.

export type CanvasIframeLanguage = "react" | "html" | "javascript" | "python";

export const PYODIDE_VERSION = "0.27.0";
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
export const PYODIDE_EXECUTION_TIMEOUT_MS = 10_000;

export interface CanvasPythonLabels {
  loading: string;
  ready: string;
  running: string;
  done: string;
  error: string;
  timedOut: string;
}

export interface BuildSandboxOptions {
  // Localized status labels for the python iframe runner. Required when
  // language === "python"; ignored otherwise.
  pythonLabels?: CanvasPythonLabels;
}

// JSON.stringify is safe for embedding in a JS string literal, but it does
// NOT escape `</script>` — a user source that includes literal `</script>`
// would break out of the surrounding `<script>` tag. Replacing `</` with
// `<\/` is the standard fix and keeps the JS-literal semantics intact.
function jsStringForHtml(value: string): string {
  return JSON.stringify(value).replace(/<\/(?=)/g, "<\\/");
}

export function buildSandboxHTML(
  userSource: string,
  language: CanvasIframeLanguage,
  options: BuildSandboxOptions = {},
): string {
  if (language === "html") {
    return userSource;
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

  if (language === "python") {
    const labels = options.pythonLabels ?? {
      loading: "Loading Pyodide…",
      ready: "Ready",
      running: "Running…",
      done: "Done",
      error: "Error",
      timedOut: "Execution exceeded the 10-second timeout.",
    };
    const FIGURE_CAPTURE_PY = `
import io, base64
try:
    import matplotlib.pyplot as plt
    result = []
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=100, bbox_inches='tight')
        result.append(base64.b64encode(buf.getvalue()).decode())
    plt.close('all')
    result
except ImportError:
    []
`;
    return `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; padding: 0; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      padding: 12px; background: white; color: #111;
    }
    .status { font-size: 11px; color: #666; margin-bottom: 8px; }
    pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px; white-space: pre-wrap; word-break: break-word;
      margin: 0 0 4px;
    }
    .stdout { color: #111; }
    .stderr { color: #c00; }
    .figs { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .figs img {
      max-width: 100%; height: auto;
      border: 1px solid #e5e5e5; border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="status" id="status"></div>
  <pre class="stdout" id="stdout"></pre>
  <pre class="stderr" id="stderr"></pre>
  <div class="figs" id="figs"></div>
  <script src="${PYODIDE_CDN}pyodide.js"></script>
  <script type="module">
    const TIMEOUT_MS = ${PYODIDE_EXECUTION_TIMEOUT_MS};
    const LABELS = ${jsStringForHtml(JSON.stringify(labels))};
    const labels = JSON.parse(LABELS);
    const USER_SOURCE = ${jsStringForHtml(userSource)};
    const FIGURE_CAPTURE = ${jsStringForHtml(FIGURE_CAPTURE_PY)};

    const statusEl = document.getElementById("status");
    const stdoutEl = document.getElementById("stdout");
    const stderrEl = document.getElementById("stderr");
    const figsEl = document.getElementById("figs");
    let outBuf = "";
    let errBuf = "";

    function postParent(msg) {
      try { parent.postMessage(msg, "*"); } catch (_) { /* sandboxed parent unreachable */ }
    }
    function postResize() {
      postParent({ type: "CANVAS_RESIZE", height: document.body.scrollHeight + 16 });
    }
    function setStatus(label) {
      statusEl.textContent = label;
      postResize();
    }
    function appendStderr(line) {
      errBuf += line + "\\n";
      stderrEl.textContent = errBuf;
      postResize();
    }

    setStatus(labels.loading);

    (async () => {
      let pyodide;
      try {
        pyodide = await loadPyodide({ indexURL: ${jsStringForHtml(PYODIDE_CDN)} });
      } catch (e) {
        appendStderr(e && e.message ? e.message : String(e));
        setStatus(labels.error);
        postParent({ type: "CANVAS_ERROR", error: String(e) });
        postParent({ type: "CANVAS_PYTHON_RESULT", figures: [], timedOut: false });
        return;
      }

      pyodide.setStdout({
        batched: (s) => {
          outBuf += s;
          stdoutEl.textContent = outBuf;
          postResize();
        },
      });
      pyodide.setStderr({
        batched: (s) => {
          errBuf += s;
          stderrEl.textContent = errBuf;
          postResize();
        },
      });

      // Force the AGG (PNG) matplotlib backend before user code runs.
      // Skipping this lets pyplot try to open a Tk window and crash the VM.
      try {
        await pyodide.runPythonAsync("import os; os.environ['MPLBACKEND'] = 'AGG'");
      } catch (_) { /* best-effort */ }

      setStatus(labels.running);

      let timedOut = false;
      let hadError = false;
      const exec = pyodide.runPythonAsync(USER_SOURCE);
      const timeout = new Promise((_, reject) =>
        setTimeout(() => {
          timedOut = true;
          reject(new Error("__CANVAS_TIMEOUT__"));
        }, TIMEOUT_MS),
      );

      try {
        await Promise.race([exec, timeout]);
      } catch (e) {
        hadError = true;
        if (timedOut || (e && e.message === "__CANVAS_TIMEOUT__")) {
          appendStderr(labels.timedOut);
          setStatus(labels.error);
          postParent({ type: "CANVAS_PYTHON_RESULT", figures: [], timedOut: true });
          return;
        }
        appendStderr(e && e.message ? e.message : String(e));
      }

      // Harvest matplotlib figures even if user code threw — partial figures
      // drawn before the exception are still useful for the user.
      let figures = [];
      try {
        const proxy = await pyodide.runPythonAsync(FIGURE_CAPTURE);
        figures = (proxy && proxy.toJs ? proxy.toJs() : []) || [];
        if (proxy && proxy.destroy) proxy.destroy();
      } catch (_) { /* matplotlib not loaded → no figures */ }

      for (const b64 of figures) {
        const img = document.createElement("img");
        img.src = "data:image/png;base64," + b64;
        figsEl.appendChild(img);
      }

      setStatus(hadError ? labels.error : labels.done);
      postParent({ type: "CANVAS_PYTHON_RESULT", figures, timedOut: false });
    })();
  </script>
</body></html>`;
  }

  // react
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
    const App = typeof globalThis.App !== "undefined" ? globalThis.App : null;
    if (App) {
      createRoot(document.getElementById("root")).render(React.createElement(App));
    } else {
      document.getElementById("root").textContent =
        "Assign your component to globalThis.App = function App() { ... } (export default is not supported in inline modules — see Phase 1 docs).";
    }
  </script>
</body></html>`;
}
