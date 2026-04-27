// Plan 11A — naive 4-chars-per-token heuristic. Replaced by a model-
// specific tokenizer (tiktoken / sentencepiece) in Plan 11B once the chat
// runtime exposes the actual provider in use. The estimate only feeds the
// chip-row token tooltip and the input-area "approximate cost" badge —
// neither of which is load-bearing for billing.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
