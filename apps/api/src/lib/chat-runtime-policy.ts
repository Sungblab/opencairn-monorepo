import { classifyChatIntent, type ChatIntent } from "./chat-intent-router";
import { envInt } from "./env";

export type ChatMode = "auto" | "fast" | "balanced" | "accurate" | "research";
export type ThinkingLevel = "low" | "medium" | "high";
export type ModelProfile = "fast" | "balanced" | "quality";
export type ResponseProfile = "general" | "study_note" | "research";

export type ChatRuntimePolicy = {
  mode: ChatMode;
  intent: ChatIntent;
  thinkingLevel: ThinkingLevel;
  modelProfile: ModelProfile;
  responseProfile: ResponseProfile;
  maxOutputTokens: number;
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

  const studyNoteMode =
    intent.studyMaterial &&
    (intent.toolAction || intent.researchDepth || intent.workspaceGrounded);
  const researchMode =
    intent.freshnessRequired || intent.researchDepth || input.mode === "research";

  const thinkingLevel =
    input.mode === "auto"
      ? studyNoteMode || researchMode || (intent.workspaceGrounded && intent.toolAction)
        ? "high"
        : "medium"
      : explicitThinking[input.mode];

  const responseProfile: ResponseProfile = studyNoteMode
    ? "study_note"
    : researchMode
      ? "research"
      : "general";
  const modelProfile: ModelProfile =
    input.mode === "fast"
      ? "fast"
      : input.mode === "balanced"
        ? "balanced"
        : thinkingLevel === "high"
          ? "quality"
          : "balanced";

  const externalGroundingRequired =
    intent.freshnessRequired || input.mode === "research";
  const workspaceEvidenceRequired = intent.workspaceGrounded;
  const maxOutputTokens =
    responseProfile === "study_note"
      ? envInt(
          "CHAT_STUDY_NOTE_MAX_OUTPUT_TOKENS",
          envInt("CHAT_ARTIFACT_MAX_OUTPUT_TOKENS", 20000),
        )
      : responseProfile === "research"
        ? envInt("CHAT_RESEARCH_MAX_OUTPUT_TOKENS", 12000)
        : input.mode === "fast"
          ? envInt("CHAT_FAST_MAX_OUTPUT_TOKENS", 4096)
          : envInt("CHAT_MAX_OUTPUT_TOKENS", 8192);

  return {
    mode: input.mode,
    intent,
    thinkingLevel,
    modelProfile,
    responseProfile,
    maxOutputTokens,
    externalGroundingRequired,
    workspaceEvidenceRequired,
    verifierRequired:
      input.mode === "accurate" ||
      input.mode === "research" ||
      externalGroundingRequired ||
      workspaceEvidenceRequired,
  };
}
