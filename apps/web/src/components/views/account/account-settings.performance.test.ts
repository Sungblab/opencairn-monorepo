import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("account settings bundle boundaries", () => {
  it("keeps AccountShell labels and routing chrome server-fed and link-light", () => {
    const shell = read("src/components/views/account/account-shell.tsx");
    const layout = read("src/app/[locale]/settings/layout.tsx");

    expect(shell).not.toContain("next/link");
    expect(shell).not.toContain("next/navigation");
    expect(shell).not.toContain("next-intl");
    expect(shell).toContain("labels: AccountShellLabels");
    expect(shell).toContain('href={`/${locale}/settings/${id}`}');
    expect(layout).toContain("getTranslations");
    expect(layout).toContain("AccountShellLabels");
    expect(layout).toContain("ACCOUNT_TABS.map");
  });

  it("keeps account settings pages behind dynamic view loaders", () => {
    const routes = [
      ["src/app/[locale]/settings/profile/page.tsx", "ProfileViewLoader", "profile-view"],
      [
        "src/app/[locale]/settings/notifications/page.tsx",
        "NotificationsViewLoader",
        "notifications-view",
      ],
      ["src/app/[locale]/settings/security/page.tsx", "SecurityViewLoader", "security-view"],
      ["src/app/[locale]/settings/billing/page.tsx", "BillingViewLoader", "billing-view"],
      ["src/app/[locale]/settings/providers/page.tsx", "ProvidersViewLoader", "providers-view"],
    ] as const;

    for (const [path, loader, forbiddenModule] of routes) {
      const source = read(path);
      expect(source).toContain(loader);
      expect(source).not.toContain("LocaleAppProviders");
      expect(source).not.toMatch(
        new RegExp(`from\\s+["']@/components/views/account/${forbiddenModule}["']`),
      );
    }
  });

  it("loads account setting views and BYOK card dynamically", () => {
    const loaders = [
      [
        "src/components/views/account/profile-view-loader.tsx",
        'import("./profile-view-runtime")',
      ],
      [
        "src/components/views/account/notifications-view-loader.tsx",
        'import("./notifications-view-runtime")',
      ],
      ["src/components/views/account/security-view-loader.tsx", 'import("./security-view")'],
      ["src/components/views/account/billing-view-loader.tsx", 'import("./billing-view")'],
      [
        "src/components/views/account/providers-view-loader.tsx",
        'import("./providers-view-runtime")',
      ],
      ["src/components/settings/ByokKeyCardLoader.tsx", 'import("./ByokKeyCardRuntime")'],
    ] as const;

    for (const [path, importString] of loaders) {
      expect(existsSync(join(root, path))).toBe(true);
      const source = read(path);
      expect(source).toContain("next/dynamic");
      expect(source).toContain(importString);
    }
  });

  it("keeps BYOK implementation out of providers and AI route entries", () => {
    const providersView = read("src/components/views/account/providers-view.tsx");
    const aiPage = read("src/app/[locale]/settings/ai/page.tsx");

    expect(providersView).toContain("ByokKeyCardLoader");
    expect(providersView).not.toMatch(
      /from\s+["']@\/components\/settings\/ByokKeyCard["']/,
    );
    expect(aiPage).toContain("ByokKeyCardLoader");
    expect(aiPage).not.toContain("LocaleAppProviders");
    expect(aiPage).not.toMatch(
      /from\s+["']@\/components\/settings\/ByokKeyCard["']/,
    );
  });

  it("moves provider-heavy account settings runtime behind the loaders", () => {
    for (const path of [
      "src/components/views/account/profile-view-runtime.tsx",
      "src/components/views/account/notifications-view-runtime.tsx",
      "src/components/views/account/providers-view-runtime.tsx",
      "src/components/settings/ByokKeyCardRuntime.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("LocaleAppProviders");
    }
  });
});
