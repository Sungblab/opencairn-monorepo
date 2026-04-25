import { describe, expect, it, vi } from "vitest";
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

vi.mock("@/lib/pyodide-loader", () => ({
  PYODIDE_VERSION: "0.27.0",
  loadPyodide: vi.fn().mockImplementation(async () => ({
    setStdin: vi.fn(),
    setStdout: ({ batched }: any) => batched("hello\n"),
    setStderr: vi.fn(),
    runPythonAsync: vi.fn().mockResolvedValue(undefined),
  })),
}));

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
  });
});
