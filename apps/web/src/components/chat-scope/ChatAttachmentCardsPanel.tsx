"use client";

import {
  AgentFileCards,
  DocumentGenerationCards,
  asAgentFileCards,
  asDocumentGenerationCards,
} from "../agent-panel/message-attachments";

export function ChatAttachmentCardsPanel({
  agentFiles,
  projectObjects,
  projectObjectGenerations,
}: {
  agentFiles?: unknown[];
  projectObjects?: unknown[];
  projectObjectGenerations?: unknown[];
}) {
  const hasAgentFiles =
    (agentFiles?.length ?? 0) > 0 || (projectObjects?.length ?? 0) > 0;
  const hasGenerations = (projectObjectGenerations?.length ?? 0) > 0;

  return (
    <>
      {hasAgentFiles ? (
        <AgentFileCards files={asAgentFileCards(agentFiles, projectObjects)} />
      ) : null}
      {hasGenerations ? (
        <DocumentGenerationCards
          items={asDocumentGenerationCards(projectObjectGenerations)}
        />
      ) : null}
    </>
  );
}
