export const THEMES = ["cairn-light", "cairn-dark", "sepia", "high-contrast"] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = "cairn-light";

export const THEME_LABELS: Record<Theme, string> = {
  "cairn-light": "Cairn Light",
  "cairn-dark": "Cairn Dark",
  sepia: "Sepia",
  "high-contrast": "High Contrast",
};

export function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (THEMES as readonly string[]).includes(v);
}
