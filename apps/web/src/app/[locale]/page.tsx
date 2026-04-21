import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { Locale } from "@/i18n";
import { LandingHeader } from "@/components/landing/chrome/Header";
import { LandingFooter } from "@/components/landing/chrome/Footer";
import { Hero } from "@/components/landing/Hero";
import { StackTicker } from "@/components/landing/StackTicker";
import { Metrics } from "@/components/landing/Metrics";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { AgentsGrid } from "@/components/landing/AgentsGrid";
import { FiveViews } from "@/components/landing/FiveViews";
import { MiniGraph } from "@/components/landing/MiniGraph";
import { WorkspaceShowcase } from "@/components/landing/WorkspaceShowcase";
import { Comparison } from "@/components/landing/Comparison";
import { Personas } from "@/components/landing/Personas";
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
  const title = t("title");
  const description = t("description");
  const ogDescription = t("ogDescription");
  return {
    title,
    description,
    openGraph: {
      title,
      description: ogDescription,
      locale: locale === "ko" ? "ko_KR" : "en_US",
    },
    twitter: {
      title,
      description: ogDescription,
    },
  };
}

export default async function Landing({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div
      data-brand="landing"
      data-theme="cairn-light"
      className="min-h-screen bg-stone-50 text-stone-800 font-sans antialiased"
    >
      <LandingHeader />
      <Hero />
      <StackTicker />
      <Metrics />
      <HowItWorks />
      <AgentsGrid />
      <FiveViews />
      <MiniGraph />
      <WorkspaceShowcase />
      <Comparison />
      <Personas />
      <DocsTeaser />
      <Pricing />
      <Faq />
      <Cta />
      <LandingFooter />
    </div>
  );
}
