import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { CanvasFrame } from "./CanvasFrame";
import koMessages from "../../../messages/ko/canvas.json";

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ canvas: koMessages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("CanvasFrame", () => {
  it("sandbox attribute is exactly 'allow-scripts' (no allow-same-origin)", () => {
    const { container } = render(
      withIntl(<CanvasFrame source="<h1>x</h1>" language="html" />),
    );
    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("source > 64KB renders error UI and does NOT mount iframe", () => {
    const big = "a".repeat(64 * 1024 + 1);
    const { container, getByText } = render(
      withIntl(<CanvasFrame source={big} language="html" />),
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(getByText(/64KB/)).toBeInTheDocument();
  });

  it("calls URL.revokeObjectURL on unmount", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const { unmount } = render(withIntl(<CanvasFrame source="x" language="html" />));
    expect(create).toHaveBeenCalled();
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:test");
    create.mockRestore();
    revoke.mockRestore();
  });
});
