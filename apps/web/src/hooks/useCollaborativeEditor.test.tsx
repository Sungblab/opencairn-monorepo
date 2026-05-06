import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCollaborativeEditor } from "./useCollaborativeEditor";

const yjsApi = vi.hoisted(() => ({
  init: vi.fn<() => Promise<void>>(),
  destroy: vi.fn(),
}));

vi.mock("@platejs/yjs/react", () => ({
  YjsPlugin: {
    configure: vi.fn((config) => config),
  },
}));

vi.mock("platejs/react", () => ({
  usePlateEditor: vi.fn(() => ({
    getApi: () => ({ yjs: yjsApi }),
  })),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useCollaborativeEditor", () => {
  beforeEach(() => {
    yjsApi.init.mockReset();
    yjsApi.destroy.mockReset();
  });

  it("does not destroy Yjs before async init has installed handlers", async () => {
    const init = deferred();
    yjsApi.init.mockReturnValue(init.promise);

    const { unmount } = renderHook(() =>
      useCollaborativeEditor({
        noteId: "note-1",
        user: { id: "u1", name: "Ada", color: "red" },
        readOnly: false,
        basePlugins: [],
      }),
    );

    unmount();

    expect(yjsApi.destroy).not.toHaveBeenCalled();

    await act(async () => {
      init.resolve();
      await init.promise;
    });

    expect(yjsApi.destroy).toHaveBeenCalledTimes(1);
  });
});
