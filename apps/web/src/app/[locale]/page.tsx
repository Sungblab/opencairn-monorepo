import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { Locale } from "@/i18n";
import { LandingHeader } from "@/components/landing/chrome/Header";
import { LandingFooter } from "@/components/landing/chrome/Footer";
import { Hero } from "@/components/landing/Hero";
import { ProblemBand } from "@/components/landing/ProblemBand";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { AgentsGrid } from "@/components/landing/AgentsGrid";
import { WorkspaceShowcase } from "@/components/landing/WorkspaceShowcase";
import { MiniGraph } from "@/components/landing/MiniGraph";
import { Personas } from "@/components/landing/Personas";
import { Comparison } from "@/components/landing/Comparison";
import { ForWhom } from "@/components/landing/ForWhom";
import { DocsTeaser } from "@/components/landing/DocsTeaser";
import { Pricing } from "@/components/landing/Pricing";
import { Faq } from "@/components/landing/Faq";
import { Cta } from "@/components/landing/Cta";

export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function Landing({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div
      data-brand="landing"
      data-theme="cairn-light"
      className="min-h-screen bg-[color:var(--brand-paper)] text-[color:var(--brand-stone-900)]"
    >
      <LandingHeader />
      <Hero />
      <ProblemBand />
      <HowItWorks />
      <AgentsGrid />
      <WorkspaceShowcase />
      <MiniGraph />
      <Personas />
      <Comparison />
      <ForWhom />
      <DocsTeaser />
      <Pricing />
      <Faq />
      <Cta />
      <LandingFooter />
    </div>
  );
}
