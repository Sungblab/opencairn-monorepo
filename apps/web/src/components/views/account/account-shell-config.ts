export const ACCOUNT_TABS = [
  "profile",
  "providers",
  "mcp",
  "security",
  "notifications",
  "billing",
] as const;

export type AccountTabId = (typeof ACCOUNT_TABS)[number];

export type AccountShellLabels = {
  title: string;
  back: string;
  tabs: Record<AccountTabId, string>;
};
