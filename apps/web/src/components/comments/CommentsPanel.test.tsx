import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommentsPanel } from "./CommentsPanel";
import type { CommentResponse } from "@/lib/api-client";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

const commentsState = vi.hoisted(() => ({
  isLoading: false,
  data: { comments: [] as CommentResponse[] },
}));

vi.mock("@/hooks/useComments", () => ({
  useComments: () => commentsState,
  useDeleteComment: () => ({ mutate: vi.fn() }),
  useResolveComment: () => ({ mutate: vi.fn() }),
}));

vi.mock("./CommentComposer", () => ({
  CommentComposer: () => <form aria-label="comment composer" />,
}));

describe("CommentsPanel", () => {
  beforeEach(() => {
    commentsState.isLoading = false;
    commentsState.data = { comments: [] };
  });

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

  it("scrolls to the requested comment after comments finish loading", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const onScrolledToTarget = vi.fn();
    commentsState.isLoading = true;
    commentsState.data = { comments: [] };

    const { rerender } = render(
      <CommentsPanel
        noteId="note-1"
        workspaceId="ws-1"
        canComment={true}
        scrollTargetCommentId="target-comment"
        onScrolledToTarget={onScrolledToTarget}
      />,
    );

    expect(scrollIntoView).not.toHaveBeenCalled();

    commentsState.isLoading = false;
    commentsState.data = {
      comments: [
        makeComment({ id: "root-comment", parentId: null }),
        makeComment({ id: "target-comment", parentId: "root-comment" }),
      ],
    };
    rerender(
      <CommentsPanel
        noteId="note-1"
        workspaceId="ws-1"
        canComment={true}
        scrollTargetCommentId="target-comment"
        onScrolledToTarget={onScrolledToTarget}
      />,
    );

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
      });
    });
    expect(onScrolledToTarget).toHaveBeenCalledOnce();
  });
});

function makeComment(
  overrides: Partial<CommentResponse>,
): CommentResponse {
  return {
    id: "comment-1",
    noteId: "note-1",
    parentId: null,
    anchorBlockId: null,
    authorId: "user-1",
    authorName: "User",
    authorAvatarUrl: null,
    body: "Comment",
    resolvedAt: null,
    resolvedBy: null,
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
    mentions: [],
    ...overrides,
  };
}
