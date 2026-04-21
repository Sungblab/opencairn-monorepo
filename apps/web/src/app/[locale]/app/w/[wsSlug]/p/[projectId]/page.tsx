import { getTranslations } from "next-intl/server";

export default async function ProjectHome() {
  const t = await getTranslations("app");
  return (
    <div className="p-8 text-fg-muted">
      <p>{t("project_home_empty")}</p>
    </div>
  );
}
