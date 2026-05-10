"use client";

import dynamic from "next/dynamic";

export type ChatAttachmentCardsLoaderProps = {
  agentFiles?: unknown[];
  projectObjects?: unknown[];
  projectObjectGenerations?: unknown[];
};

const LazyChatAttachmentCardsPanel =
  dynamic<ChatAttachmentCardsLoaderProps>(
    () =>
      import("./ChatAttachmentCardsPanel").then(
        (mod) => mod.ChatAttachmentCardsPanel,
      ),
    { ssr: false, loading: () => null },
  );

export function ChatAttachmentCardsLoader(
  props: ChatAttachmentCardsLoaderProps,
) {
  const hasAgentFiles =
    (props.agentFiles?.length ?? 0) > 0 ||
    (props.projectObjects?.length ?? 0) > 0;
  const hasGenerations = (props.projectObjectGenerations?.length ?? 0) > 0;

  if (!hasAgentFiles && !hasGenerations) return null;
  return <LazyChatAttachmentCardsPanel {...props} />;
}
