"use client";

import { useMemo, useRef, useState } from "react";
import type { AgentAction } from "@opencairn/shared";
import { interactionChoiceInputSchema } from "@opencairn/shared";

import { agentActionsApi } from "@/lib/api-client";
import {
  InteractionCard,
  type AgentInteractionCard,
  type AgentInteractionCardOption,
  type InteractionCardSubmit,
} from "./interaction-card";

export type InteractionActionAnswered = InteractionCardSubmit & {
  action: AgentAction;
  optionId?: string;
};

export function InteractionActionCard({
  action,
  onAnswered,
}: {
  action: AgentAction;
  onAnswered(input: InteractionActionAnswered): void;
}) {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const card = useMemo(() => actionToCard(action), [action]);

  if (!card) return null;

  async function handleSubmit(input: InteractionCardSubmit) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await agentActionsApi.respondToInteractionChoice(action.id, {
        ...(input.option ? { optionId: input.option.id } : {}),
        value: input.value,
        label: input.label,
      });
      onAnswered({
        ...input,
        action,
        actionId: action.id,
        ...(input.option ? { optionId: input.option.id } : {}),
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <InteractionCard
      card={card}
      disabled={pending}
      onSubmit={(input) => void handleSubmit(input)}
    />
  );
}

function actionToCard(action: AgentAction): AgentInteractionCard | null {
  if (action.kind !== "interaction.choice" || action.status !== "draft") {
    return null;
  }
  const parsed = interactionChoiceInputSchema.safeParse(action.input);
  if (!parsed.success) return null;
  const input = parsed.data;
  return {
    type: "choice",
    id: input.cardId,
    prompt: input.prompt,
    allowCustom: input.allowCustom,
    options: input.options.map((option): AgentInteractionCardOption => ({
      id: option.id,
      label: option.label,
      value: option.value,
    })),
  };
}
