import { beforeEach, describe, expect, it } from "vitest";
import { useThreadsStore } from "./threads-store";

describe("threads-store", () => {
  beforeEach(() => {
    localStorage.clear();
    useThreadsStore.setState(useThreadsStore.getInitialState(), true);
  });

  it("activeThreadId null by default", () => {
    useThreadsStore.getState().setWorkspace("ws-a");
    expect(useThreadsStore.getState().activeThreadId).toBeNull();
  });

  it("setActiveThread persists under oc:active_thread:<wsId>", () => {
    useThreadsStore.getState().setWorkspace("ws-a");
    useThreadsStore.getState().setActiveThread("thread-42");
    expect(localStorage.getItem("oc:active_thread:ws-a")).toBe(
      JSON.stringify("thread-42"),
    );
  });

  it("setWorkspace loads persisted value", () => {
    localStorage.setItem(
      "oc:active_thread:ws-b",
      JSON.stringify("thread-99"),
    );
    useThreadsStore.getState().setWorkspace("ws-b");
    expect(useThreadsStore.getState().activeThreadId).toBe("thread-99");
  });
});
