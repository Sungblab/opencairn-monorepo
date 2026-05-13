import { classifyChatIntent, type ChatIntent } from "./chat-intent-router";

export type ChatMode = "auto" | "fast" | "balanced" | "accurate" | "research";
export type ThinkingLevel = "low" | "medium" | "high";

export type ChatRuntimePolicy = {
  mode: ChatMode;
  intent: ChatIntent;
  thinkingLevel: ThinkingLevel;
  externalGroundingRequired: boolean;
  workspaceEvidenceRequired: boolean;
  verifierRequired: boolean;
};

export function selectChatRuntimePolicy(input: {
  mode: ChatMode;
  userMessage: string;
}): ChatRuntimePolicy {
  const intent = classifyChatIntent(input.userMessage);

  const explicitThinking: Record<Exclude<ChatMode, "auto">, ThinkingLevel> = {
    fast: "low",
    balanced: "medium",
    accurate: "high",
    research: "high",
  };

  const thinkingLevel =
    input.mode === "auto"
      ? intent.freshnessRequired ||
        intent.researchDepth ||
        (intent.workspaceGrounded && intent.toolAction)
        ? "high"
        : "medium"
      : explicitThinking[input.mode];

  const externalGroundingRequired =
    intent.freshnessRequired || input.mode === "research";
  const workspaceEvidenceRequired = intent.workspaceGrounded;

  return {
    mode: input.mode,
    intent,
    thinkingLevel,
    externalGroundingRequired,
    workspaceEvidenceRequired,
    verifierRequired:
      input.mode === "accurate" ||
      input.mode === "research" ||
      externalGroundingRequired ||
      workspaceEvidenceRequired,
  };
}
