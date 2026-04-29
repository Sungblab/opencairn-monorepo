import { useTranslations } from "next-intl";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function RefundPage() {
  const tLegal = useTranslations("common.footer.legal");
  const tPh = useTranslations("common.placeholder");
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-sans text-4xl">{tLegal("refund")}</h1>
      <p className="mt-6 text-fg-muted">{tPh("comingSoon")}</p>
    </main>
  );
}
