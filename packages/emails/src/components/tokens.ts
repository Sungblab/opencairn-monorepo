// OpenCairn brand tokens for email templates.
// Palette: neutral monochrome only.
// All colors inline-safe for email client rendering (no CSS variables — Outlook doesn't resolve them).

export const colors = {
  text: "#111111",
  textMuted: "#6b7280",
  background: "#ffffff",
  surface: "#f5f5f5",
  border: "#e5e5e5",
  primary: "#111111",       // CTA fill
  primaryText: "#ffffff",   // CTA label
  link: "#111111",
} as const;

export const fonts = {
  body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Pretendard, sans-serif',
  logo: 'ui-serif, Georgia, serif', // serif reserved for the wordmark only
} as const;

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
} as const;

export const layout = {
  containerMaxWidth: "600px",
} as const;
