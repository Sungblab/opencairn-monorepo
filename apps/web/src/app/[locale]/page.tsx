import { setRequestLocale, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { Locale } from "@/i18n";
import { siteUrl } from "@/lib/site-config";
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

// App Shell Phase 1: authenticated users get redirected to their last-viewed
// workspace (or first membership / onboarding as fallback). Anonymous users
// still see the landing page. The check forces dynamic rendering on `/` —
// landing was previously force-static and re-rendered on every hit; this
// perf delta is acceptable because anonymous landing render is server-only
// and authed users redirect away before any landing component runs.
export const dynamic = "force-dynamic";

// Fetch wrapper that swallows network errors. The landing must keep
// rendering even if the API is briefly unreachable (boot race during
// `pnpm dev`, transient outage in prod) — better to show landing to a
// signed-in user for one frame than to 500 the marketing page.
// `redirect()` throws a NEXT_REDIRECT signal, so it is re-thrown.
async function safeFetch(
  url: string,
  init?: RequestInit,
): Promise<Response | null> {
  try {
    return await fetch(url, init);
  } catch {
    return null;
  }
}

async function redirectAuthed(locale: string): Promise<void> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return;
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
  const headers = { cookie: cookieHeader };

  const meRes = await safeFetch(`${base}/api/auth/me`, {
    headers,
    cache: "no-store",
  });
  if (!meRes?.ok) return;

  // Last viewed workspace wins; falls back to first membership; falls back
  // to /onboarding so first-run users land in the create-workspace flow
  // rather than the marketing page.
  const lvRes = await safeFetch(
    `${base}/api/users/me/last-viewed-workspace`,
    { headers, cache: "no-store" },
  );
  if (lvRes?.ok) {
    const { workspace } = (await lvRes.json()) as {
      workspace: { id: string; slug: string } | null;
    };
    if (workspace) redirect(`/${locale}/app/w/${workspace.slug}/`);
  }

  const wsRes = await safeFetch(`${base}/api/workspaces`, {
    headers,
    cache: "no-store",
  });
  if (wsRes?.ok) {
    const list = (await wsRes.json()) as Array<{ slug: string }>;
    if (list[0]?.slug) redirect(`/${locale}/app/w/${list[0].slug}/`);
  }

  redirect(`/${locale}/onboarding`);
}

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
  const path = locale === "ko" ? "/" : "/en";
  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    alternates: {
      canonical: path,
      languages: {
        ko: "/",
        en: "/en",
        "x-default": "/",
      },
    },
    openGraph: {
      title,
      description: ogDescription,
      locale: locale === "ko" ? "ko_KR" : "en_US",
      alternateLocale: locale === "ko" ? ["en_US"] : ["ko_KR"],
      url: path,
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
  await redirectAuthed(locale);
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
