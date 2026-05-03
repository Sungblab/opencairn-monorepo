import { getGeminiProvider } from "./gemini";
import { getOpenAICompatibleProvider } from "./openai-compatible";
import type { LLMProvider } from "./provider";

export function getChatProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER ?? "gemini";
  if (provider === "gemini") return getGeminiProvider();
  if (provider === "openai_compatible") return getOpenAICompatibleProvider();
  if (provider === "ollama") {
    throw new Error(
      "API chat does not use native Ollama; set LLM_PROVIDER=openai_compatible " +
        "and point OPENAI_COMPAT_BASE_URL at Ollama /v1",
    );
  }
  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}
