export type RuntimeContextInput = {
  now?: Date;
  locale?: string;
  timezone?: string;
};

export function buildRuntimeContext(input: RuntimeContextInput = {}): string {
  const now = input.now ?? new Date();
  const locale = input.locale ?? "ko";
  const timezone = input.timezone ?? "Asia/Seoul";

  return [
    "[Runtime Context]",
    `Current server time: ${now.toISOString()}`,
    `User locale: ${locale}`,
    `User timezone: ${timezone}`,
    "Server current time outranks model training data and internal date assumptions.",
    "Resolve relative dates such as today, yesterday, tomorrow, latest, and recent from the server time above.",
    "If a current or recent factual answer is needed, use verified grounding or state that the latest state could not be verified.",
  ].join("\n");
}
