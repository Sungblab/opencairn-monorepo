import { describe, expect, it } from "vitest";

import {
  appendInteractionResponseToScope,
  noteDraftContentFromText,
} from "./interaction-card-actions";
import type { AgentInteractionCard } from "./interaction-card";

const card: AgentInteractionCard = {
  type: "choice",
  id: "card-1",
  prompt: "어떤 형태로 만들까요?",
  options: [
    {
      id: "summary",
      label: "요약 노트",
      value: "요약 노트로 정리해줘.",
      action: { type: "create_note_draft" },
    },
  ],
};

describe("interaction-card actions", () => {
  it("stores a selected choice as traceable scope metadata", () => {
    expect(
      appendInteractionResponseToScope(
        {
          manifest: {
            workspaceId: "workspace-1",
            sourcePolicy: "auto_project",
            memoryPolicy: "auto",
            externalSearch: "allowed",
            actionApprovalMode: "require",
          },
          chips: [],
          strict: "strict",
        },
        {
          card,
          option: card.options[0],
          value: "요약 노트로 정리해줘.",
          label: "요약 노트",
        },
      ),
    ).toMatchObject({
      interaction: {
        type: "choice_response",
        cardId: "card-1",
        optionId: "summary",
        label: "요약 노트",
        value: "요약 노트로 정리해줘.",
      },
    });
  });

  it("builds a note draft body from the current context and selected answer", () => {
    expect(
      noteDraftContentFromText("요약 노트로 정리해줘.", "라즈베리파이"),
    ).toEqual([
      {
        type: "p",
        children: [{ text: "라즈베리파이\n\n요약 노트로 정리해줘." }],
      },
    ]);
  });
});
