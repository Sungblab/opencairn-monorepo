import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("landing static section bundle boundary", () => {
  it("keeps non-interactive landing sections as server components", () => {
    const staticSections = [
      "src/components/landing/AgentsGrid.tsx",
      "src/components/landing/Comparison.tsx",
      "src/components/landing/Cta.tsx",
      "src/components/landing/DocsTeaser.tsx",
      "src/components/landing/Faq.tsx",
      "src/components/landing/FiveViews.tsx",
      "src/components/landing/HowItWorks.tsx",
      "src/components/landing/Metrics.tsx",
      "src/components/landing/Personas.tsx",
      "src/components/landing/Pricing.tsx",
      "src/components/landing/WorkspaceShowcase.tsx",
      "src/components/landing/chrome/Footer.tsx",
    ];

    for (const path of staticSections) {
      const source = read(path).trimStart();
      expect(source, path).not.toMatch(/^["']use client["'];?/);
      expect(source, path).not.toContain("useScrollReveal");
    }
  });

  it("loads the below-fold landing graph through a lazy client boundary", () => {
    const page = read("src/app/[locale]/page.tsx");
    const loader = read("src/components/landing/MiniGraphLoader.tsx");
    const graph = read("src/components/landing/MiniGraph.tsx");

    expect(page).toContain("@/components/landing/MiniGraphLoader");
    expect(page).not.toMatch(/from\s+["']@\/components\/landing\/MiniGraph["']/);
    expect(page).toContain("miniGraphCopy");
    expect(loader).toContain("copy: MiniGraphCopy");
    expect(loader).toContain("next/dynamic");
    expect(loader).toContain('import("./MiniGraph")');
    expect(graph).not.toContain("next-intl");
  });

  it("keeps decorative landing hero panels server-rendered without hydration hooks", () => {
    const hero = read("src/components/landing/Hero.tsx");

    expect(hero.trimStart()).not.toMatch(/^["']use client["'];?/);
    expect(hero).not.toContain("useEffect");
    expect(hero).not.toContain("useRef");
    expect(hero).not.toContain("useState");
    expect(hero).toContain("./HeroTypewriterText");
    expect(hero).toContain("./HeroActivityCard");
    expect(hero).toContain("./HeroLivePanel");

    for (const path of [
      "src/components/landing/HeroTypewriterText.tsx",
      "src/components/landing/HeroActivityCard.tsx",
      "src/components/landing/HeroLivePanel.tsx",
    ]) {
      const source = read(path);
      expect(source.trimStart(), path).not.toMatch(/^["']use client["'];?/);
      expect(source, path).not.toContain("useEffect");
      expect(source, path).not.toContain("useRef");
      expect(source, path).not.toContain("useState");
      expect(source, path).not.toContain("window.");
      expect(source, path).not.toContain("matchMedia");
    }
  });

  it("keeps mobile hero spacing clear below the sticky landing header", () => {
    const hero = read("src/components/landing/Hero.tsx");

    expect(hero).toContain("pt-10");
    expect(hero).not.toContain("pt-4 pb-20");
  });

  it("keeps the landing header shell server-rendered without auth modal hydration", () => {
    const header = read("src/components/landing/chrome/Header.tsx");

    expect(header.trimStart()).not.toMatch(/^["']use client["'];?/);
    expect(header).not.toContain("useEffect");
    expect(header).not.toContain("useRef");
    expect(header).not.toContain("useState");
    expect(header).not.toContain("next/dynamic");
    expect(header).not.toContain("./LandingAuthButton");
    expect(header).not.toMatch(
      /import\s+\{\s*AuthModal\s*\}\s+from\s+["']@\/components\/auth\/AuthModal["']/,
    );
    expect(header).not.toContain('import("@/components/auth/AuthModal")');
    expect(header).toContain('href={`/${locale}/auth/login`}');
  });

  it("keeps the landing locale switcher out of the shared app dropdown stack", () => {
    const header = read("src/components/landing/chrome/Header.tsx");
    const footer = read("src/components/landing/chrome/Footer.tsx");
    const localeLink = read("src/components/landing/chrome/LandingLocaleLink.tsx");

    expect(header).not.toContain("@/components/i18n/LanguageSwitcher");
    expect(footer).not.toContain("@/components/i18n/LanguageSwitcher");
    expect(header).toContain("./LandingLocaleLink");
    expect(footer).toContain("./LandingLocaleLink");
    expect(localeLink).toContain("@/lib/locale-cookie");
    expect(header).toContain("nextLocale");
  });
});
