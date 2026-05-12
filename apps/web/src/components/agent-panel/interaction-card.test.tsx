import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InteractionCard, type AgentInteractionCard } from "./interaction-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (!values) return key;
    return `${key}:${JSON.stringify(values)}`;
  },
}));

const card: AgentInteractionCard = {
  type: "choice",
  id: "card-1",
  prompt: "어떤 형태로 정리할까요?",
  allowCustom: true,
  options: [
    { id: "summary", label: "요약 노트", value: "요약 노트로 정리해줘." },
    { id: "table", label: "비교표", value: "비교표로 정리해줘." },
  ],
};

describe("InteractionCard", () => {
  it("renders choice options and sends the selected answer", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<InteractionCard card={card} onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "요약 노트" }));

    expect(onSubmit).toHaveBeenCalledWith({
      card,
      option: card.options[0],
      value: "요약 노트로 정리해줘.",
      label: "요약 노트",
    });
  });

  it("supports a direct custom input fallback", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<InteractionCard card={card} onSubmit={onSubmit} />);
    await user.type(
      screen.getByLabelText("customInput"),
      "발표 흐름으로 정리",
    );
    await user.click(
      screen.getByRole("button", {
        name: "customSubmit",
      }),
    );

    expect(onSubmit).toHaveBeenCalledWith({
      card,
      option: null,
      value: "발표 흐름으로 정리",
      label: "발표 흐름으로 정리",
    });
  });

  it("renders answered state without active controls", () => {
    render(
      <InteractionCard
        card={{
          ...card,
          answered: { value: "요약 노트로 정리해줘.", label: "요약 노트" },
        }}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText(/answered/)).toHaveTextContent(
      "요약 노트",
    );
    expect(
      screen.queryByRole("button", { name: "요약 노트" }),
    ).not.toBeInTheDocument();
  });
});
