import { beforeEach, describe, expect, it } from "vitest";
import { usePaletteStore } from "./palette-store";

describe("palette-store", () => {
  beforeEach(() =>
    usePaletteStore.setState(usePaletteStore.getInitialState(), true),
  );

  it("open/close toggles", () => {
    usePaletteStore.getState().open();
    expect(usePaletteStore.getState().isOpen).toBe(true);
    usePaletteStore.getState().close();
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });

  it("query updates and clears on close", () => {
    usePaletteStore.getState().open();
    usePaletteStore.getState().setQuery("hello");
    expect(usePaletteStore.getState().query).toBe("hello");
    usePaletteStore.getState().close();
    expect(usePaletteStore.getState().query).toBe("");
  });
});
