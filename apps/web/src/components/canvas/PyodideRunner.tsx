"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { loadPyodide } from "@/lib/pyodide-loader";

export const EXECUTION_TIMEOUT_MS = 10_000;

type Status = "loading" | "ready" | "running" | "done" | "error";

type Props = {
  source: string;
  stdin?: string;
  onResult?: (r: {
    stdout: string;
    stderr: string;
    figures: string[];
    timedOut: boolean;
  }) => void;
};

// Plan 7 Canvas Phase 2 — matplotlib figure capture.
//
// We force the AGG (non-interactive PNG) backend BEFORE running user code so
// `matplotlib.pyplot` writes to in-memory buffers instead of trying to spin
// up a Tk/Qt window (which would crash inside the Pyodide WebAssembly VM).
// AFTER the run we walk every figure number, save it to a `BytesIO`, and
// base64-encode the bytes. Returning the strings to JS via `.toJs()` lets
// the gallery render them as `data:image/png;base64,...` previews.
//
// The wrapper is wrapped in `try/except ImportError` so notes that don't
// import matplotlib still finish cleanly — we just emit `figures: []`.
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

export function PyodideRunner({ source, stdin = "", onResult }: Props) {
  const t = useTranslations("canvas");
  const [status, setStatus] = useState<Status>("loading");
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");

  // Latest-callback-ref pattern: keeps the effect from re-running just because
  // the caller passed a fresh inline arrow for onResult.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    let cancelled = false;
    let outBuf = "";
    let errBuf = "";

    (async () => {
      try {
        const pyodide = await loadPyodide();
        if (cancelled) return;
        setStatus("ready");

        const lines = stdin.split("\n");
        let idx = 0;
        pyodide.setStdin({
          stdin: () => (idx < lines.length ? lines[idx++] : null),
        });

        // Pyodide's batched callback delivers chunks that already include
        // the newlines from `print(...)` — appending another `\n` would
        // double-space the visible output.
        pyodide.setStdout({
          batched: (s: string) => {
            outBuf += s;
            if (!cancelled) setStdout(outBuf);
          },
        });
        pyodide.setStderr({
          batched: (s: string) => {
            errBuf += s;
            if (!cancelled) setStderr(errBuf);
          },
        });

        // Force the AGG (PNG) matplotlib backend before user code runs.
        // Skipping this lets pyplot try to open a Tk window and crash the VM.
        try {
          await pyodide.runPythonAsync(
            `import os; os.environ['MPLBACKEND'] = 'AGG'`,
          );
        } catch {
          // Best-effort: if even this fails we still want the user code to run
          // — they just won't get figures back.
        }

        setStatus("running");
        const exec = pyodide.runPythonAsync(source);
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("__CANVAS_TIMEOUT__")),
            EXECUTION_TIMEOUT_MS,
          ),
        );

        try {
          await Promise.race([exec, timeout]);
          if (cancelled) return;

          // After the user code finishes, harvest matplotlib figures. The
          // wrapper above no-ops if matplotlib isn't installed, so this is
          // safe to call unconditionally.
          let figures: string[] = [];
          try {
            const proxy = await pyodide.runPythonAsync(FIGURE_CAPTURE_PY);
            figures = (proxy?.toJs?.() ?? []) as string[];
            // PyProxy memory has to be freed manually; otherwise Pyodide
            // leaks one Python object per render of a figure-producing run.
            proxy?.destroy?.();
          } catch {
            figures = [];
          }

          setStatus("done");
          onResultRef.current?.({
            stdout: outBuf,
            stderr: errBuf,
            figures,
            timedOut: false,
          });
        } catch (e) {
          if (cancelled) return;
          const timedOut = (e as Error).message === "__CANVAS_TIMEOUT__";
          const msg = timedOut
            ? t("errors.executionTimeout")
            : (e as Error).message;
          const errLine = msg + "\n";
          setStatus("error");
          setStderr((prev) => prev + errLine);
          onResultRef.current?.({
            stdout: outBuf,
            stderr: errBuf + errLine,
            figures: [],
            timedOut,
          });
        }
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setStderr(String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
    // Empty deps on purpose: callers (CanvasViewer, /canvas/demo) trigger
    // re-execution via `key={runId}` remount, so source/stdin prop updates
    // during a mount (typing into the editor, late note hydration) must not
    // re-fire the run loop. `onResult` is read through the ref above so a
    // fresh inline arrow doesn't force a re-run either.
  }, []);

  return (
    <div className="rounded-xl border bg-background p-4 space-y-2">
      <div className="text-xs text-muted-foreground" data-testid="status">
        {t(`runner.status.${status}`)}
      </div>
      {stdout && (
        <pre
          className="text-sm whitespace-pre-wrap font-mono"
          data-testid="stdout"
        >
          {stdout}
        </pre>
      )}
      {stderr && (
        <pre
          className="text-sm whitespace-pre-wrap font-mono text-destructive"
          data-testid="stderr"
        >
          {stderr}
        </pre>
      )}
    </div>
  );
}
