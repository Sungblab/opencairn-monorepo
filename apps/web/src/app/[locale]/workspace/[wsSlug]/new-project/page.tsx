import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { projectTemplates } from "@opencairn/shared";
import {
  NewProjectTemplateClient,
  type ProjectTemplateClientLabels,
} from "./NewProjectTemplateClient";

export default async function NewProject({
  params,
}: {
  params: Promise<{ locale: string; wsSlug: string }>;
}) {
  const { locale, wsSlug } = await params;
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

  const wsRes = await fetch(`${base}/api/workspaces/by-slug/${wsSlug}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!wsRes.ok) notFound();
  const ws = (await wsRes.json()) as { id: string; name: string };
  const t = await getTranslations("projectTemplates");
  const labels: ProjectTemplateClientLabels = {
    title: t("title"),
    description: t("description"),
    galleryLabel: t("galleryLabel"),
    quickCreate: {
      label: t("quickCreate.label"),
      placeholder: t("quickCreate.placeholder"),
      button: t("quickCreate.button"),
    },
    imageCreate: {
      title: t("imageCreate.title"),
      description: t("imageCreate.description"),
      pick: t("imageCreate.pick"),
      change: t("imageCreate.change"),
      button: t("imageCreate.button"),
    },
    error: t("error"),
    templates: Object.fromEntries(
      projectTemplates.map((template) => [
        template.id,
        {
          title: t(`templates.${template.id}.title`),
          description: t(`templates.${template.id}.description`),
          projectCount:
            template.id === "empty_project"
              ? t("blankProjectCount")
              : t("projectCount", { count: template.projects.length }),
        },
      ]),
    ) as ProjectTemplateClientLabels["templates"],
  };

  return (
    <NewProjectTemplateClient
      locale={locale}
      wsSlug={wsSlug}
      workspaceId={ws.id}
      labels={labels}
    />
  );
}
