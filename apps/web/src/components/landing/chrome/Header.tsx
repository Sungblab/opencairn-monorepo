"use client";
import { useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCairnStack } from "@/lib/landing/hooks/useCairnStack";

export function LandingHeader() {
  const tNav = useTranslations("common.nav");
  const tLanding = useTranslations("landing");
  const logoRef = useRef<HTMLSpanElement>(null);
  useCairnStack(logoRef);

  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--brand-stone-200)] bg-[color:var(--brand-paper)]/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-baseline gap-2.5">
          <span
            ref={logoRef}
            className="font-serif text-2xl text-[color:var(--brand-stone-900)]"
          >
            OpenCairn
          </span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <a href="#pricing" className="text-[color:var(--brand-stone-600)] hover:text-[color:var(--brand-stone-900)]">
            {tLanding("pricing.heading")}
          </a>
          <Link href="/dashboard" className="text-[color:var(--brand-stone-600)] hover:text-[color:var(--brand-stone-900)]">
            {tNav("signIn")}
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full bg-[color:var(--brand-stone-900)] px-4 py-2 text-[color:var(--brand-paper)] hover:opacity-90"
          >
            {tNav("signUp")}
          </Link>
        </nav>
      </div>
    </header>
  );
}
