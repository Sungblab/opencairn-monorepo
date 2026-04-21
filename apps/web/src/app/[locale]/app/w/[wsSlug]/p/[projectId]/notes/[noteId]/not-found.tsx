import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <div className="p-8 text-fg-muted">
      <p>{t("not_found")}</p>
    </div>
  );
}
