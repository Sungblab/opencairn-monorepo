import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ErrorPage from "./error";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      retry: "다시 시도",
      home: "홈으로",
      label: "[ 500 · INTERNAL ERROR ]",
      title: "문제가 발생했습니다",
      body: "예기치 못한 오류예요.",
      digest: "오류 코드",
    };
    return messages[key] ?? key;
  },
}));

describe("route error page", () => {
  it("refreshes the route after resetting the error boundary", () => {
    const reset = vi.fn();
    render(<ErrorPage error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(reset).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
