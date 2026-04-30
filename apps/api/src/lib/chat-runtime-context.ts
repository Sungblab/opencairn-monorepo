export type RuntimeContextInput = {
  now?: Date;
  locale?: string;
  timezone?: string;
};

export function buildRuntimeContext(input: RuntimeContextInput = {}): string {
  const now = input.now ?? new Date();
  const locale = input.locale ?? "ko";
  const timezone = input.timezone ?? "Asia/Seoul";
  const localTime = formatLocalTime(now, timezone);

  return [
    "[Runtime Context]",
    `Current server time: ${now.toISOString()} (UTC)`,
    `User local time: ${localTime} (${timezone})`,
    `User locale: ${locale}`,
    `User timezone: ${timezone}`,
    "Server current time outranks model training data and internal date assumptions.",
    "Resolve relative dates such as today, yesterday, tomorrow, latest, and recent from the server time above.",
    "If a current or recent factual answer is needed, use verified grounding or state that the latest state could not be verified.",
  ].join("\n");
}

function formatLocalTime(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "shortOffset",
    }).formatToParts(now);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";

    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")} ${get("timeZoneName")}`.trim();
  } catch {
    return now.toISOString();
  }
}
