import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { ThreadList } from "./thread-list";

const archiveMutateAsync = vi.fn();
const setActiveThread = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ wsSlug: "workspace" }),
}));

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    relativeTime: () => "방금 전",
  }),
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/hooks/use-hydrated-now", () => ({
  useHydratedNow: () => new Date("2026-05-11T00:00:00Z"),
}));

vi.mock("@/hooks/useWorkspaceId", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@/hooks/use-chat-threads", () => ({
  useChatThreads: () => ({
    threads: [
      {
        id: "thread-1",
        title: "요약 요청",
        created_at: "2026-05-11T00:00:00Z",
        updated_at: "2026-05-11T00:00:00Z",
      },
    ],
    isLoading: false,
    archive: { mutateAsync: archiveMutateAsync, isPending: false },
  }),
}));

vi.mock("@/stores/threads-store", () => ({
  useThreadsStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeThreadId: "thread-1",
      setActiveThread,
    }),
}));

describe("ThreadList", () => {
  const renderThreadList = () =>
    render(
      <DropdownMenu>
        <ThreadList />
      </DropdownMenu>,
    );

  it("renders as chat history with a delete action", () => {
    renderThreadList();

    expect(
      screen.getByText("agentPanel.thread_list.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "agentPanel.thread_list.delete_aria",
      }),
    ).toBeInTheDocument();
  });

  it("archives the selected thread and clears it when delete is clicked", async () => {
    archiveMutateAsync.mockResolvedValueOnce(undefined);

    renderThreadList();

    fireEvent.click(
      screen.getByRole("button", {
        name: "agentPanel.thread_list.delete_aria",
      }),
    );

    await waitFor(() =>
      expect(archiveMutateAsync).toHaveBeenCalledWith("thread-1"),
    );
    expect(setActiveThread).toHaveBeenCalledWith(null);
  });
});
