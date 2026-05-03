import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koMessages from "../../../messages/ko/canvas.json";
import { CodeAgentPanel, type CodeAgentRunResult } from "./CodeAgentPanel";

vi.mock("@/lib/api-client-code", () => ({
  codeApi: {
    startRun: vi.fn().mockResolvedValue({ runId: "run-xyz" }),
    sendFeedback: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ canvas: koMessages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

const NOTE_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(async () => {
  const mod = await import("@/lib/api-client-code");
  (mod.codeApi.startRun as unknown as ReturnType<typeof vi.fn>).mockClear();
  (mod.codeApi.startRun as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    runId: "run-xyz",
  });
});

describe("CodeAgentPanel", () => {
  it("renders a disabled experimental state without a run button", async () => {
    const { queryByTestId, getByTestId } = render(
      withIntl(
        <CodeAgentPanel
          enabled={false}
          noteId={NOTE_ID}
          language="python"
          runResult={null}
          onApply={vi.fn()}
        />,
      ),
    );

    expect(getByTestId("agent-disabled").textContent).toContain("실험 기능");
    expect(queryByTestId("agent-prompt")).toBeNull();
    expect(queryByTestId("agent-run")).toBeNull();

    const { codeApi } = await import("@/lib/api-client-code");
    expect(codeApi.startRun).not.toHaveBeenCalled();
  });

  it("idle → submitting prompt triggers codeApi.startRun and onStart", async () => {
    const onApply = vi.fn();
    const onStart = vi.fn();
    const { getByTestId } = render(
      withIntl(
        <CodeAgentPanel
          noteId={NOTE_ID}
          language="python"
          runResult={null}
          onApply={onApply}
          onStart={onStart}
        />,
      ),
    );

    const textarea = getByTestId("agent-prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "draw sin(x)" } });
    fireEvent.click(getByTestId("agent-run"));

    const { codeApi } = await import("@/lib/api-client-code");
    await waitFor(() =>
      expect(codeApi.startRun).toHaveBeenCalledWith({
        noteId: NOTE_ID,
        prompt: "draw sin(x)",
        language: "python",
      }),
    );
    await waitFor(() => expect(onStart).toHaveBeenCalledWith("run-xyz"));
  });

  it("renders Apply / Discard when awaiting_feedback with a turn", () => {
    const onApply = vi.fn();
    const runResult: CodeAgentRunResult = {
      status: "awaiting_feedback",
      turns: [
        {
          kind: "generate",
          source: "print('hello')",
          explanation: "",
          seq: 0,
        },
      ],
    };
    const { getByTestId } = render(
      withIntl(
        <CodeAgentPanel
          noteId={NOTE_ID}
          language="python"
          runResult={runResult}
          onApply={onApply}
        />,
      ),
    );

    expect(getByTestId("agent-apply")).toBeTruthy();
    expect(getByTestId("agent-discard")).toBeTruthy();
    expect(getByTestId("agent-preview").textContent).toContain("print('hello')");

    fireEvent.click(getByTestId("agent-apply"));
    expect(onApply).toHaveBeenCalledWith("print('hello')");
  });

  it("shows turn counter (2 / 4) when two turns have been emitted", () => {
    const runResult: CodeAgentRunResult = {
      status: "awaiting_feedback",
      turns: [
        { kind: "generate", source: "v1", explanation: "", seq: 0 },
        { kind: "fix", source: "v2", explanation: "", seq: 1 },
      ],
    };
    const { getByTestId } = render(
      withIntl(
        <CodeAgentPanel
          noteId={NOTE_ID}
          language="python"
          runResult={runResult}
          onApply={vi.fn()}
        />,
      ),
    );
    expect(getByTestId("agent-turns").textContent).toMatch(/2\s*\/\s*4/);
  });
});
