import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import editorMessages from "@/../messages/ko/editor.json";
import { EditorToolbar, type ToolbarActions } from "./editor-toolbar";

const renderToolbar = (actions: Partial<ToolbarActions> = {}) => {
  const fullActions: ToolbarActions = {
    toggleMark: vi.fn(),
    toggleBlock: vi.fn(),
    insertBlock: vi.fn(),
    ...actions,
  };

  render(
    <NextIntlClientProvider locale="ko" messages={{ editor: editorMessages }}>
      <EditorToolbar actions={fullActions} />
    </NextIntlClientProvider>,
  );

  return fullActions;
};

describe("EditorToolbar", () => {
  it("keeps the top toolbar focused on formatting and insert controls", () => {
    renderToolbar();

    expect(
      screen.queryByRole("button", { name: "AI에게 질문" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "자료로 노트 만들기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "수식 블록" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "표" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "알림 박스" }),
    ).toBeInTheDocument();
  });

  it("dispatches insert actions without moving focus out of the editor", () => {
    const actions = renderToolbar();

    fireEvent.mouseDown(screen.getByRole("button", { name: "수식 블록" }));
    fireEvent.mouseDown(screen.getByRole("button", { name: "표" }));
    fireEvent.mouseDown(screen.getByRole("button", { name: "알림 박스" }));

    expect(actions.insertBlock).toHaveBeenNthCalledWith(1, "math");
    expect(actions.insertBlock).toHaveBeenNthCalledWith(2, "table");
    expect(actions.insertBlock).toHaveBeenNthCalledWith(3, "callout");
  });
});
