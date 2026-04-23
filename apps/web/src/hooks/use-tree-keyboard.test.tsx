import { render, fireEvent, act } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { useRef, useState, useEffect } from "react";
import { useTypeAhead } from "./use-tree-keyboard";

function Harness({ onBufChange }: { onBufChange: Mock }) {
  const ref = useRef<HTMLDivElement>(null);
  const [buf, setBuf] = useState("");
  useTypeAhead(ref, setBuf, { ttlMs: 200 });
  useEffect(() => {
    onBufChange(buf);
  }, [buf, onBufChange]);
  return (
    <div ref={ref} tabIndex={0} data-testid="scope">
      <input data-testid="input" />
    </div>
  );
}

describe("useTypeAhead", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accumulates printable keystrokes inside the scope element", () => {
    const onBufChange = vi.fn();
    const { getByTestId } = render(<Harness onBufChange={onBufChange} />);
    const scope = getByTestId("scope");
    fireEvent.keyDown(scope, { key: "r" });
    fireEvent.keyDown(scope, { key: "o" });
    fireEvent.keyDown(scope, { key: "a" });
    expect(onBufChange).toHaveBeenLastCalledWith("roa");
  });

  it("clears the buffer after the TTL elapses", () => {
    const onBufChange = vi.fn();
    const { getByTestId } = render(<Harness onBufChange={onBufChange} />);
    const scope = getByTestId("scope");
    fireEvent.keyDown(scope, { key: "x" });
    expect(onBufChange).toHaveBeenLastCalledWith("x");
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onBufChange).toHaveBeenLastCalledWith("");
  });

  it("ignores keystrokes from inputs inside the scope", () => {
    const onBufChange = vi.fn();
    const { getByTestId } = render(<Harness onBufChange={onBufChange} />);
    const input = getByTestId("input");
    fireEvent.keyDown(input, { key: "a" });
    fireEvent.keyDown(input, { key: "b" });
    // Initial render fires onBufChange("") once; no further calls from the
    // input events.
    expect(onBufChange).toHaveBeenCalledTimes(1);
  });

  it("ignores modifier chords", () => {
    const onBufChange = vi.fn();
    const { getByTestId } = render(<Harness onBufChange={onBufChange} />);
    const scope = getByTestId("scope");
    fireEvent.keyDown(scope, { key: "k", ctrlKey: true });
    fireEvent.keyDown(scope, { key: "j", metaKey: true });
    expect(onBufChange).toHaveBeenCalledTimes(1);
  });
});
