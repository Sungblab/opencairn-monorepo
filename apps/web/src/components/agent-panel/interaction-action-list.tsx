"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentAction } from "@opencairn/shared";

import { agentActionsApi } from "@/lib/api-client";
import {
  InteractionActionCard,
  type InteractionActionAnswered,
} from "./interaction-action-card";

export function InteractionActionList({
  projectId,
  onAnswered,
}: {
  projectId: string | null;
  onAnswered(input: InteractionActionAnswered): void;
}) {
  const qc = useQueryClient();
  const queryKey = ["agent-actions", projectId, "interaction.choice", "draft"];
  const { data } = useQuery({
    queryKey,
    enabled: Boolean(projectId),
    queryFn: async () => {
      if (!projectId) return { actions: [] as AgentAction[] };
      return agentActionsApi.list(projectId, {
        kind: "interaction.choice",
        status: "draft",
        limit: 20,
      });
    },
  });
  const actions = data?.actions ?? [];
  if (actions.length === 0) return null;

  return (
    <section
      className="border-b border-border p-2"
      aria-label="interaction choices"
    >
      <div className="flex flex-col gap-2">
        {actions.map((action) => (
          <InteractionActionCard
            key={action.id}
            action={action}
            onAnswered={(input) => {
              void qc.invalidateQueries({ queryKey: ["agent-actions"] });
              void qc.invalidateQueries({ queryKey });
              onAnswered(input);
            }}
          />
        ))}
      </div>
    </section>
  );
}
