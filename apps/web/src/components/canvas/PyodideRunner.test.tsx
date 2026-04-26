import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koMessages from "../../../messages/ko/canvas.json";
import { PyodideRunner } from "./PyodideRunner";

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ canvas: koMessages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

// We mock the loader once and override its return value per-test via
// `mockImplementation`. The runner makes 3 sequential `runPythonAsync` calls
// in order:
//   1. `os.environ['MPLBACKEND'] = 'AGG'` — backend pin
//   2. user source
//   3. matplotlib figure-capture wrapper → returns a PyProxy with `.toJs()`
// The default mock below makes call (3) return an empty proxy so legacy
// tests keep their `figures: []` shape.
vi.mock("@/lib/pyodide-loader", () => ({
  PYODIDE_VERSION: "0.27.0",
  loadPyodide: vi.fn(),
}));

beforeEach(async () => {
  const mod = await import("@/lib/pyodide-loader");
  (mod.loadPyodide as unknown as ReturnType<typeof vi.fn>).mockReset();
  // Default: stdout emits "hello\n", figure-capture returns empty proxy.
  (mod.loadPyodide as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async () => {
      const runPythonAsync = vi
        .fn()
        // 1st call: backend pin
        .mockResolvedValueOnce(undefined)
        // 2nd call: user code
        .mockResolvedValueOnce(undefined)
        // 3rd call: figure capture
        .mockResolvedValueOnce({
          toJs: () => [],
          destroy: () => undefined,
        });
      return {
        setStdin: vi.fn(),
        setStdout: ({ batched }: { batched: (s: string) => void }) =>
          batched("hello\n"),
        setStderr: vi.fn(),
        runPythonAsync,
      };
    },
  );
});

describe("PyodideRunner", () => {
  it("transitions through loading → ready → running → done and reports result", async () => {
    const onResult = vi.fn();
    const { findByText } = render(
      withIntl(<PyodideRunner source="print('hello')" onResult={onResult} />),
    );
    // Initial loading status
    await findByText(/Pyodide 로드 중/);
    // onResult fires after run completes (timedOut=false)
    await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 5000 });
    expect(onResult.mock.calls[0][0].timedOut).toBe(false);
    expect(onResult.mock.calls[0][0].figures).toEqual([]);
  });

  it("captures matplotlib figures and emits via onResult", async () => {
    const mod = await import("@/lib/pyodide-loader");
    const destroy = vi.fn();
    (mod.loadPyodide as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        const runPythonAsync = vi
          .fn()
          // 1st: backend pin
          .mockResolvedValueOnce(undefined)
          // 2nd: user source
          .mockResolvedValueOnce(undefined)
          // 3rd: figure capture wrapper returns a PyProxy with two figures
          .mockResolvedValueOnce({
            toJs: () => ["<base64-A>", "<base64-B>"],
            destroy,
          });
        return {
          setStdin: vi.fn(),
          setStdout: vi.fn(),
          setStderr: vi.fn(),
          runPythonAsync,
        };
      },
    );

    const onResult = vi.fn();
    render(
      withIntl(
        <PyodideRunner
          source="import matplotlib.pyplot as plt; plt.plot([1,2])"
          onResult={onResult}
        />,
      ),
    );

    await waitFor(() => expect(onResult).toHaveBeenCalled(), { timeout: 5000 });
    const payload = onResult.mock.calls[0][0];
    expect(payload.figures).toEqual(["<base64-A>", "<base64-B>"]);
    expect(payload.timedOut).toBe(false);
    // PyProxy memory must be released to avoid leaks across reruns.
    expect(destroy).toHaveBeenCalled();
  });
});
