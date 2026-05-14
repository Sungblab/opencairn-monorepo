import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Composer } from "./composer";
import { PROJECT_TREE_DRAG_MIME } from "@/lib/project-tree-dnd";

// Mirror the next-intl shim used elsewhere in the suite (see
// sidebar-footer.test.tsx). Returning `${ns}.${key}` keeps assertions
// stable across locale swaps and avoids pulling in the real provider.
vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

const PLACEHOLDER = "agentPanel.composer.placeholder";
const INPUT_LABEL = "agentPanel.composer.input_aria";
const VOICE_LABEL = "agentPanel.composer.voice_aria";
const SEND_LABEL = "agentPanel.composer.send_aria";
const STOP_LABEL = "agentPanel.composer.stop_aria";
const ADD_MENU_LABEL = "agentPanel.composer.add_menu_aria";
const ACTION_REQUIRE_LABEL = "agentPanel.composer.actionApproval.require_aria";
const ACTION_AUTO_LABEL = "agentPanel.composer.actionApproval.auto_aria";

describe("Composer", () => {
  it("labels the message textarea for assistive technology", () => {
    render(<Composer onSend={vi.fn()} />);
    expect(screen.getByLabelText(INPUT_LABEL)).toBeInTheDocument();
  });

  it("focuses the textarea when a new draft is started", () => {
    const { rerender } = render(<Composer onSend={vi.fn()} focusKey={0} />);

    rerender(<Composer onSend={vi.fn()} focusKey={1} />);

    expect(screen.getByLabelText(INPUT_LABEL)).toHaveFocus();
  });

  it("keeps the textarea compact enough for narrow agent panels", () => {
    render(<Composer onSend={vi.fn()} />);
    expect(screen.getByLabelText(INPUT_LABEL)).toHaveClass("min-h-9");
  });

  it("uses the shared app control radius for the composer shell and icon controls", () => {
    render(<Composer onSend={vi.fn()} />);

    const textarea = screen.getByLabelText(INPUT_LABEL);
    expect(textarea.parentElement).toHaveClass(
      "rounded-[var(--radius-control)]",
    );
    expect(textarea.parentElement).toHaveClass("relative");
    expect(screen.getByLabelText(VOICE_LABEL)).toHaveClass(
      "rounded-[var(--radius-control)]",
    );
    expect(screen.getByLabelText(ADD_MENU_LABEL)).toHaveClass(
      "rounded-[var(--radius-control)]",
    );
  });

  it("passes selected files to the attachment handler", () => {
    const onAttachFile = vi.fn();
    render(<Composer onSend={vi.fn()} onAttachFile={onAttachFile} />);
    const input = screen.getByTestId("agent-composer-file-input");
    const file = new File(["hello"], "paper.pdf", { type: "application/pdf" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(onAttachFile).toHaveBeenCalledWith(file);
  });

  it("passes dropped OS files to the attachment handler", () => {
    const onAttachFile = vi.fn();
    render(<Composer onSend={vi.fn()} onAttachFile={onAttachFile} />);
    const file = new File(["hello"], "paper.pdf", { type: "application/pdf" });

    fireEvent.drop(screen.getByTestId("agent-composer"), {
      dataTransfer: { files: [file], types: ["Files"], getData: () => "" },
    });

    expect(onAttachFile).toHaveBeenCalledWith(file);
  });

  it("passes dropped project tree nodes to the reference handler", () => {
    const onAttachTreeNode = vi.fn();
    const payload = {
      id: "node-1",
      kind: "note",
      label: "Source note",
      targetId: "note-1",
      parentId: null,
    };
    render(<Composer onSend={vi.fn()} onAttachTreeNode={onAttachTreeNode} />);

    fireEvent.drop(screen.getByTestId("agent-composer"), {
      dataTransfer: {
        files: [],
        types: [PROJECT_TREE_DRAG_MIME],
        getData: (type: string) =>
          type === PROJECT_TREE_DRAG_MIME ? JSON.stringify(payload) : "",
      },
    });

    expect(onAttachTreeNode).toHaveBeenCalledWith(payload);
  });

  it("keeps explicit context controls behind the add menu", () => {
    const onCommand = vi.fn();
    const onToggleActiveContext = vi.fn();
    render(
      <Composer
        onSend={vi.fn()}
        onCommand={onCommand}
        activeContextLabel="Source note"
        activeContextEnabled
        onToggleActiveContext={onToggleActiveContext}
      />,
    );

    fireEvent.click(screen.getByLabelText(ADD_MENU_LABEL));
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", {
        name: "agentPanel.composer.addMenu.activeTabOn",
      }),
    );

    expect(onToggleActiveContext).toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("exposes auto apply as an explicit opt-in behind the add menu", () => {
    const onToggleActionApprovalMode = vi.fn();
    render(
      <Composer
        onSend={vi.fn()}
        actionApprovalMode="require"
        onToggleActionApprovalMode={onToggleActionApprovalMode}
      />,
    );

    fireEvent.click(screen.getByLabelText(ADD_MENU_LABEL));
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", {
        name: "agentPanel.composer.addMenu.autoApplyOff",
      }),
    );

    expect(onToggleActionApprovalMode).toHaveBeenCalled();
  });

  it("starts research from the add menu instead of the response mode selector", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);

    fireEvent.click(screen.getByLabelText(ADD_MENU_LABEL));
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: /agentPanel\.composer\.addMenu\.research/,
      }),
    );
    fireEvent.click(screen.getByLabelText(SEND_LABEL));

    expect(onSend).toHaveBeenCalledWith({
      content: "agentPanel.composer.slash.prompt.research",
      mode: "research",
      command: "research",
    });
  });

  it("shows the action approval mode as a visible composer toggle", () => {
    const onToggleActionApprovalMode = vi.fn();
    const { rerender } = render(
      <Composer
        onSend={vi.fn()}
        actionApprovalMode="require"
        onToggleActionApprovalMode={onToggleActionApprovalMode}
      />,
    );

    expect(
      screen.getByRole("button", { name: ACTION_REQUIRE_LABEL }),
    ).toHaveTextContent("agentPanel.composer.actionApproval.trigger_label");
    expect(
      screen.getByRole("button", { name: ACTION_REQUIRE_LABEL }),
    ).toHaveTextContent("agentPanel.composer.actionApproval.require_short");
    fireEvent.click(screen.getByRole("button", { name: ACTION_REQUIRE_LABEL }));
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: /agentPanel\.composer\.actionApproval\.auto_safe_label/,
      }),
    );
    expect(onToggleActionApprovalMode).toHaveBeenCalled();

    rerender(
      <Composer
        onSend={vi.fn()}
        actionApprovalMode="auto_safe"
        onToggleActionApprovalMode={onToggleActionApprovalMode}
      />,
    );

    expect(
      screen.getByRole("button", { name: ACTION_AUTO_LABEL }),
    ).toBeInTheDocument();
  });

  it("surfaces response stop in the composer while an answer is streaming", () => {
    const onStopResponse = vi.fn();
    render(
      <Composer onSend={vi.fn()} responding onStopResponse={onStopResponse} />,
    );

    fireEvent.click(screen.getByRole("button", { name: STOP_LABEL }));

    expect(onStopResponse).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(VOICE_LABEL)).not.toBeInTheDocument();
  });

  it("does not expose web search as a manual toggle", () => {
    render(<Composer onSend={vi.fn()} />);

    fireEvent.click(screen.getByLabelText(ADD_MENU_LABEL));

    expect(
      screen.queryByRole("menuitemcheckbox", {
        name: "agentPanel.composer.addMenu.webSearch",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps reference chips out of the input surface", () => {
    render(
      <Composer
        onSend={vi.fn()}
        activeContextLabel="Source note"
        activeContextEnabled
      />,
    );

    expect(screen.queryByText("Source note")).not.toBeInTheDocument();
    expect(screen.queryByText("paper.pdf")).not.toBeInTheDocument();
    expect(
      screen.queryByText("agentPanel.composer.context.projectIndex"),
    ).not.toBeInTheDocument();
  });

  it("shows mic when empty, send when non-empty", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    expect(screen.getByLabelText(VOICE_LABEL)).toBeInTheDocument();
    expect(screen.queryByLabelText(SEND_LABEL)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), {
      target: { value: "hi" },
    });

    expect(screen.getByLabelText(SEND_LABEL)).toBeInTheDocument();
    expect(screen.queryByLabelText(VOICE_LABEL)).not.toBeInTheDocument();
  });

  it("Enter submits with the current mode", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith({ content: "hi", mode: "auto" });
  });

  it("opens a slash command menu when the user starts with /", () => {
    render(<Composer onSend={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), {
      target: { value: "/" },
    });

    expect(
      screen.getByRole("listbox", {
        name: "agentPanel.composer.slash.menu_aria",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listbox", {
        name: "agentPanel.composer.slash.menu_aria",
      }),
    ).toHaveClass("absolute");
    expect(
      screen.getByRole("option", { name: /summarize/i }),
    ).toBeInTheDocument();
  });

  it("parses slash commands into a command id and cleaned content", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER);

    fireEvent.change(ta, { target: { value: "/summarize 핵심만 정리해줘" } });
    fireEvent.keyDown(ta, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith({
      content: "핵심만 정리해줘",
      mode: "auto",
      command: "summarize",
    });
  });

  it("can send the default prompt after selecting a slash command from the menu", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER);

    fireEvent.change(ta, { target: { value: "/" } });
    fireEvent.click(screen.getByRole("option", { name: /summarize/i }));
    fireEvent.click(screen.getByLabelText(SEND_LABEL));

    expect(onSend).toHaveBeenCalledWith({
      content: "agentPanel.composer.slash.prompt.summarize",
      mode: "auto",
      command: "summarize",
    });
  });

  it("lets the user cancel a selected slash command before sending", () => {
    render(<Composer onSend={vi.fn()} />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER);

    fireEvent.change(ta, { target: { value: "/" } });
    fireEvent.click(screen.getByRole("option", { name: /summarize/i }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "agentPanel.composer.slash.clear_command_aria",
      }),
    );

    expect(
      screen.queryByRole("button", {
        name: "agentPanel.composer.slash.clear_command_aria",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(SEND_LABEL)).not.toBeInTheDocument();
    expect(screen.getByLabelText(VOICE_LABEL)).toBeInTheDocument();
  });

  it("discovers the figure generation slash command", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER);

    fireEvent.change(ta, { target: { value: "/figure" } });
    fireEvent.click(
      screen.getByRole("option", {
        name: /agentPanel\.composer\.slash\.command\.generate_figure/,
      }),
    );
    fireEvent.click(screen.getByLabelText(SEND_LABEL));

    expect(onSend).toHaveBeenCalledWith({
      content: "agentPanel.composer.slash.prompt.generate_figure",
      mode: "balanced",
      command: "generate_figure",
    });
  });

  it("supports keyboard navigation in the slash command menu", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER);

    fireEvent.change(ta, { target: { value: "/" } });
    fireEvent.keyDown(ta, { key: "ArrowDown" });
    fireEvent.keyDown(ta, { key: "Enter" });
    fireEvent.click(screen.getByLabelText(SEND_LABEL));

    expect(onSend).toHaveBeenCalledWith({
      content: "agentPanel.composer.slash.prompt.decompose",
      mode: "accurate",
      command: "decompose",
    });
  });

  it("Shift+Enter does not submit", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("trims whitespace before sending and ignores blank input", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER);

    fireEvent.change(ta, { target: { value: "   " } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.change(ta, { target: { value: "  hello  " } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith({ content: "hello", mode: "auto" });
  });

  it("clears the textarea after a successful send", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(ta.value).toBe("");
    // Empty input → mic returns, send disappears.
    expect(screen.getByLabelText(VOICE_LABEL)).toBeInTheDocument();
  });

  it("respects the disabled prop (no submit on Enter)", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});
