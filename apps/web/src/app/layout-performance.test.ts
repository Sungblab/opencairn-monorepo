import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("root layout performance boundaries", () => {
  it("keeps KaTeX CSS out of the global root layout", () => {
    const layout = read("src/app/layout.tsx");

    expect(layout).not.toContain("katex/dist/katex.min.css");
  });

  it("keeps KaTeX CSS colocated with math-capable rendering entrypoints", () => {
    expect(read("src/components/chat/markdown-math-plugins.ts")).toContain(
      "katex/dist/katex.min.css",
    );
    expect(read("src/components/chat/chat-message-renderer.tsx")).not.toContain(
      "katex/dist/katex.min.css",
    );
    expect(read("src/components/editor/plugins/latex.tsx")).toContain(
      "katex/dist/katex.min.css",
    );
    expect(read("src/components/share/plate-static-renderer.tsx")).toContain(
      "katex/dist/katex.min.css",
    );
  });

  it("loads the global toaster implementation through a lazy layout boundary", () => {
    const appProviders = read(
      "src/components/providers/locale-app-providers.tsx",
    );
    const loader = read("src/components/ui/toaster-loader.tsx");

    expect(appProviders).toContain("@/components/ui/toaster-loader");
    expect(appProviders).not.toMatch(
      /from\s+["']@\/components\/ui\/toaster["']/,
    );
    expect(loader).toContain("next/dynamic");
    expect(loader).toContain('import("./toaster")');
    expect(loader).toContain("@/lib/performance/use-idle-ready");
    expect(loader).toContain(
      "useIdleReady({ timeout: 2000, fallbackMs: 1000 })",
    );
    expect(loader).toContain("return ready ? <Toaster /> : null");
  });

  it("keeps app-only providers out of the public locale layout", () => {
    const localeLayout = read("src/app/[locale]/layout.tsx");

    expect(localeLayout).not.toContain("NextIntlClientProvider");
    expect(localeLayout).not.toContain("getMessages");
    expect(localeLayout).not.toContain("ReactQueryProvider");
    expect(localeLayout).not.toContain("ToasterLoader");
    expect(localeLayout).not.toContain("CommandPalette");
    expect(localeLayout).not.toContain("@/lib/react-query");
    expect(localeLayout).not.toContain("@/components/palette/command-palette");
  });

  it("moves client intl providers to route groups that need client translations", () => {
    const providerPath = "src/components/providers/intl-client-provider.tsx";

    expect(existsSync(join(root, providerPath))).toBe(true);
    expect(read(providerPath)).toContain("NextIntlClientProvider");
    expect(read(providerPath)).toContain("getMessages");
    expect(read(providerPath)).toContain("pickMessages");

    for (const intlRoutePath of [
      "src/app/[locale]/app/layout.tsx",
      "src/app/[locale]/workspace/[wsSlug]/layout.tsx",
      "src/app/[locale]/auth/layout.tsx",
      "src/app/[locale]/settings/layout.tsx",
      "src/app/[locale]/onboarding/layout.tsx",
      "src/app/[locale]/canvas/layout.tsx",
      "src/app/[locale]/admin/page.tsx",
      "src/app/[locale]/s/[token]/page.tsx",
    ]) {
      expect(read(intlRoutePath), intlRoutePath).toContain(
        "IntlClientProvider",
      );
    }

    for (const [intlRoutePath, namespaces] of [
      ["src/app/[locale]/auth/layout.tsx", 'namespaces={["auth"]}'],
      [
        "src/app/[locale]/settings/layout.tsx",
        'namespaces={["account", "accountNotifications", "settings"]}',
      ],
      ["src/app/[locale]/onboarding/layout.tsx", 'namespaces={["onboarding"]}'],
      ["src/app/[locale]/canvas/layout.tsx", 'namespaces={["canvas"]}'],
      ["src/app/[locale]/admin/page.tsx", 'namespaces={["admin"]}'],
      ["src/app/[locale]/s/[token]/page.tsx", 'namespaces={["publicShare"]}'],
    ]) {
      expect(read(intlRoutePath), intlRoutePath).toContain(namespaces);
    }

    for (const serverOnlyPath of [
      "src/app/[locale]/page.tsx",
      "src/app/[locale]/dashboard/layout.tsx",
      "src/app/[locale]/dashboard/page.tsx",
      "src/app/[locale]/help/page.tsx",
      "src/app/[locale]/report/page.tsx",
    ]) {
      expect(read(serverOnlyPath), serverOnlyPath).not.toContain(
        "IntlClientProvider",
      );
    }
  });

  it("keeps locale fallback boundaries off client routing and intl runtimes", () => {
    for (const boundaryPath of [
      "src/app/not-found.tsx",
      "src/app/[locale]/error.tsx",
      "src/app/[locale]/not-found.tsx",
    ]) {
      const boundary = read(boundaryPath);

      expect(boundary).not.toContain("next/link");
      expect(boundary).not.toContain("next/navigation");
      expect(boundary).not.toContain("next-intl");
      expect(boundary).toContain('href="/"');
    }
  });

  it("mounts app-only providers only in authenticated app layouts", () => {
    const providerPath = "src/components/providers/locale-app-providers.tsx";

    expect(existsSync(join(root, providerPath))).toBe(true);
    expect(read(providerPath)).toContain("ReactQueryProvider");
    expect(read(providerPath)).toContain("ToasterLoader");
    expect(read(providerPath)).toContain("CommandPalette");

    for (const layoutPath of [
      "src/app/[locale]/app/layout.tsx",
      "src/app/[locale]/workspace/[wsSlug]/layout.tsx",
    ]) {
      expect(read(layoutPath)).toContain("LocaleAppProviders");
    }

    for (const runtimePath of [
      "src/components/settings/ByokKeyCardRuntime.tsx",
      "src/components/settings/mcp/McpSettingsClientRuntime.tsx",
      "src/components/views/account/notifications-view-runtime.tsx",
      "src/components/views/account/profile-view-runtime.tsx",
      "src/components/views/account/providers-view-runtime.tsx",
    ]) {
      expect(read(runtimePath)).toContain("LocaleAppProviders");
    }

    for (const pagePath of [
      "src/app/[locale]/settings/ai/page.tsx",
      "src/app/[locale]/settings/mcp/page.tsx",
      "src/app/[locale]/settings/notifications/page.tsx",
      "src/app/[locale]/settings/profile/page.tsx",
      "src/app/[locale]/settings/providers/page.tsx",
    ]) {
      expect(read(pagePath)).not.toContain("LocaleAppProviders");
    }

    for (const publicPath of [
      "src/app/[locale]/page.tsx",
      "src/app/[locale]/auth/layout.tsx",
      "src/app/[locale]/canvas/layout.tsx",
      "src/app/[locale]/dashboard/layout.tsx",
      "src/app/[locale]/onboarding/layout.tsx",
      "src/app/[locale]/settings/billing/page.tsx",
      "src/app/[locale]/settings/layout.tsx",
      "src/app/[locale]/settings/security/page.tsx",
      "src/app/[locale]/s/[token]/page.tsx",
    ]) {
      expect(read(publicPath)).not.toContain("LocaleAppProviders");
    }
  });
});
