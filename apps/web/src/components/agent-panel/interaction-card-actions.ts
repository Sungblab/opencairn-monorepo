import type { AgentContextPayload } from "./context-manifest";
import type { InteractionCardSubmit } from "./interaction-card";

export function noteDraftContentFromText(text: string, contextTitle?: string) {
  const lines = [
    ...(contextTitle ? [contextTitle] : []),
    text,
  ].filter(Boolean);
  return [
    {
      type: "p",
      children: [{ text: lines.join("\n\n") }],
    },
  ];
}

export function appendInteractionResponseToScope(
  scope: AgentContextPayload,
  input: InteractionCardSubmit,
) {
  return {
    ...scope,
    interaction: {
      type: "choice_response",
      cardId: input.card.id,
      ...(input.option ? { optionId: input.option.id } : {}),
      label: input.label,
      value: input.value,
    },
  };
}
