import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import koCommon from "@/../messages/ko/common.json";
import { VisualizeDialog } from "../VisualizeDialog";

// Both hooks the dialog depends on are unit-tested elsewhere; here we
// stub them so we can drive the dialog's UI states deterministically
// (idle / submitting / success / error) without spinning up SSE or zustand.
vi.mock("../useVisualizeMutation", () => ({ useVisualizeMutation: vi.fn() }));
vi.mock("../../useViewSpecApply", () => ({ useViewSpecApply: vi.fn() }));

import { useVisualizeMutation } from "../useVisualizeMutation";
import { useViewSpecApply } from "../../useViewSpecApply";

type DialogProps = React.ComponentProps<typeof VisualizeDialog>;

function renderD(props: Partial<DialogProps> = {}) {
  return render(
    <NextIntlClientProvider
      locale="ko"
      messages={{ graph: koGraph, common: koCommon }}
    >
      <VisualizeDialog
        open
        onClose={() => {
          /* noop */
        }}
        projectId="p-1"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("VisualizeDialog", () => {
  let submit: ReturnType<typeof vi.fn>;
  let cancel: ReturnType<typeof vi.fn>;
  let apply: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    submit = vi.fn();
    cancel = vi.fn();
    apply = vi.fn();
    (useViewSpecApply as ReturnType<typeof vi.fn>).mockReturnValue(apply);
    (useVisualizeMutation as ReturnType<typeof vi.fn>).mockReturnValue({
      submit,
      cancel,
      progress: [],
      viewSpec: null,
      error: null,
      submitting: false,
    });
  });

  it("renders title + prompt textarea + submit button", () => {
    renderD();
    expect(screen.getByText(koGraph.ai.dialogTitle)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(koGraph.ai.promptPlaceholder),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: koGraph.ai.submit }),
    ).toBeInTheDocument();
  });

  it("submit calls mutation with prompt + projectId + auto viewType", () => {
    renderD();
    fireEvent.change(
      screen.getByPlaceholderText(koGraph.ai.promptPlaceholder),
      { target: { value: "transformer mindmap" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: koGraph.ai.submit }),
    );
    expect(submit).toHaveBeenCalledWith({
      projectId: "p-1",
      prompt: "transformer mindmap",
      viewType: undefined,
    });
  });

  it("submit is disabled while prompt is empty or whitespace", () => {
    renderD();
    const btn = screen.getByRole("button", { name: koGraph.ai.submit });
    expect(btn).toBeDisabled();
    fireEvent.change(
      screen.getByPlaceholderText(koGraph.ai.promptPlaceholder),
      { target: { value: "   " } },
    );
    expect(btn).toBeDisabled();
    fireEvent.change(
      screen.getByPlaceholderText(koGraph.ai.promptPlaceholder),
      { target: { value: "ok" } },
    );
    expect(btn).not.toBeDisabled();
  });

  it("forwards a chosen viewType into the mutation call", () => {
    renderD();
    fireEvent.change(
      screen.getByPlaceholderText(koGraph.ai.promptPlaceholder),
      { target: { value: "show timeline" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: koGraph.ai.viewType_timeline }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: koGraph.ai.submit }),
    );
    expect(submit).toHaveBeenCalledWith({
      projectId: "p-1",
      prompt: "show timeline",
      viewType: "timeline",
    });
  });

  it("when viewSpec arrives, applies it and closes the dialog", async () => {
    const onClose = vi.fn();
    const spec = {
      viewType: "graph",
      layout: "fcose",
      rootId: null,
      nodes: [],
      edges: [],
    };
    (useVisualizeMutation as ReturnType<typeof vi.fn>).mockReturnValue({
      submit,
      cancel,
      progress: [],
      viewSpec: spec,
      error: null,
      submitting: false,
    });
    renderD({ onClose });
    await waitFor(() => {
      expect(apply).toHaveBeenCalledWith(spec, "p-1");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("renders error message when error present", () => {
    (useVisualizeMutation as ReturnType<typeof vi.fn>).mockReturnValue({
      submit,
      cancel,
      progress: [],
      viewSpec: null,
      error: "visualizeFailed",
      submitting: false,
    });
    renderD();
    expect(
      screen.getByText(koGraph.errors.visualizeFailed),
    ).toBeInTheDocument();
  });

  it("falls back to a generic message for unknown error codes", () => {
    (useVisualizeMutation as ReturnType<typeof vi.fn>).mockReturnValue({
      submit,
      cancel,
      progress: [],
      viewSpec: null,
      error: "some_unmapped_code",
      submitting: false,
    });
    renderD();
    expect(
      screen.getByText(koGraph.errors.visualizeFailed),
    ).toBeInTheDocument();
  });

  it("cancel button cancels mutation while submitting", () => {
    (useVisualizeMutation as ReturnType<typeof vi.fn>).mockReturnValue({
      submit,
      cancel,
      progress: [],
      viewSpec: null,
      error: null,
      submitting: true,
    });
    renderD();
    fireEvent.click(screen.getByRole("button", { name: /취소|Cancel/ }));
    expect(cancel).toHaveBeenCalled();
  });

  it("renders progress events with friendly labels", () => {
    (useVisualizeMutation as ReturnType<typeof vi.fn>).mockReturnValue({
      submit,
      cancel,
      progress: [
        { event: "tool_use", payload: { name: "search_concepts", callId: "1" } },
        { event: "tool_result", payload: { callId: "1", ok: true } },
      ],
      viewSpec: null,
      error: null,
      submitting: true,
    });
    renderD();
    expect(
      screen.getByText(new RegExp(koGraph.ai.progress.search_concepts)),
    ).toBeInTheDocument();
  });
});
