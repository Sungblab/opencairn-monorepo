import { useTranslations } from "next-intl";

export default function PrivacyPage() {
  const tLegal = useTranslations("common.footer.legal");
  const tPh = useTranslations("common.placeholder");
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-serif text-4xl">{tLegal("privacy")}</h1>
      <p className="mt-6 text-fg-muted">{tPh("comingSoon")}</p>
    </main>
  );
}
