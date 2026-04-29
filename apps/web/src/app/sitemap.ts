import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-config";

const languages = {
  ko: `${siteUrl}/`,
  en: `${siteUrl}/en`,
};

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: languages.ko,
      lastModified,
      priority: 1.0,
      alternates: { languages },
    },
    {
      url: languages.en,
      lastModified,
      priority: 0.9,
      alternates: { languages },
    },
  ];
}
