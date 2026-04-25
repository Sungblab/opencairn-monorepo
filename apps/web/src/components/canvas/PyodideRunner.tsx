"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { loadPyodide } from "@/lib/pyodide-loader";

export const EXECUTION_TIMEOUT_MS = 10_000;

type Status = "loading" | "ready" | "running" | "done" | "error";

type Props = {
  source: string;
  stdin?: string;
  onResult?: (r: { stdout: string; stderr: string; timedOut: boolean }) => void;
};

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
          setStatus("done");
          onResultRef.current?.({
            stdout: outBuf,
            stderr: errBuf,
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
    // Intentionally omit onResult and t — see latest-callback-ref pattern above.
  }, [source, stdin]);

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
