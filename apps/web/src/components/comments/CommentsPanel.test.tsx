import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommentsPanel } from "./CommentsPanel";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

vi.mock("@/hooks/useComments", () => ({
  useComments: () => ({
    isLoading: false,
    data: { comments: [] },
  }),
}));

vi.mock("./CommentComposer", () => ({
  CommentComposer: () => <form aria-label="comment composer" />,
}));

describe("CommentsPanel", () => {
  it("stacks below the editor on mobile and becomes a rail on wide screens", () => {
    render(
      <CommentsPanel noteId="note-1" workspaceId="ws-1" canComment={true} />,
    );

    const panel = screen.getByRole("complementary", {
      name: "collab.comments.panel_title",
    });
    expect(panel.className).toContain("w-full");
    expect(panel.className).toContain("xl:w-80");
    expect(panel.className).toContain("border-t");
    expect(panel.className).toContain("xl:border-l");
  });
});
