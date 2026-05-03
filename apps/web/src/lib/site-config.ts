const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, "");
};

const cleanEmail = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
};

export const siteUrl =
  clean(process.env.NEXT_PUBLIC_SITE_URL) ??
  clean(process.env.NEXT_PUBLIC_BASE_URL) ??
  "http://localhost:3000";

export const siteConfig = {
  name: clean(process.env.NEXT_PUBLIC_SITE_NAME) ?? "OpenCairn",
  descriptionKo: clean(process.env.NEXT_PUBLIC_SITE_DESCRIPTION_KO),
  descriptionEn: clean(process.env.NEXT_PUBLIC_SITE_DESCRIPTION_EN),
  authorName:
    clean(process.env.NEXT_PUBLIC_SITE_AUTHOR_NAME) ??
    "OpenCairn contributors",
  authorUrl: clean(process.env.NEXT_PUBLIC_SITE_AUTHOR_URL),
  contactEmail: cleanEmail(process.env.NEXT_PUBLIC_CONTACT_EMAIL),
} as const;

const externalPath = (path: string) => `${siteUrl}${path}`;

export const externalSiteUrls = {
  privacy:
    clean(process.env.NEXT_PUBLIC_LEGAL_PRIVACY_URL) ??
    externalPath("/privacy"),
  terms:
    clean(process.env.NEXT_PUBLIC_LEGAL_TERMS_URL) ?? externalPath("/terms"),
  refund:
    clean(process.env.NEXT_PUBLIC_LEGAL_REFUND_URL) ??
    externalPath("/refund"),
  blog: clean(process.env.NEXT_PUBLIC_BLOG_URL) ?? externalPath("/blog"),
} as const;

const repositoryUrl =
  clean(process.env.NEXT_PUBLIC_REPOSITORY_URL) ??
  "https://github.com/opencairn/opencairn";

const repositoryPath = (path: string) => `${repositoryUrl}${path}`;

export const publicLinks = {
  repository: repositoryUrl,
  repositoryDocs:
    clean(process.env.NEXT_PUBLIC_DOCS_URL) ??
    repositoryPath("/tree/main/docs"),
  repositoryAdrs:
    clean(process.env.NEXT_PUBLIC_ADR_URL) ??
    repositoryPath("/tree/main/docs/architecture/adr"),
  repositoryIssues:
    clean(process.env.NEXT_PUBLIC_ISSUES_URL) ?? repositoryPath("/issues"),
  license:
    clean(process.env.NEXT_PUBLIC_LICENSE_URL) ??
    repositoryPath("/blob/main/LICENSE"),
  contactEmail: siteConfig.contactEmail
    ? `mailto:${siteConfig.contactEmail}`
    : undefined,
  support: clean(process.env.NEXT_PUBLIC_SUPPORT_URL),
  changelog: clean(process.env.NEXT_PUBLIC_CHANGELOG_URL),
  cla: clean(process.env.NEXT_PUBLIC_CLA_URL),
  discord: clean(process.env.NEXT_PUBLIC_DISCORD_URL),
  twitter: clean(process.env.NEXT_PUBLIC_TWITTER_URL),
  roadmap: clean(process.env.NEXT_PUBLIC_ROADMAP_URL),
  author: siteConfig.authorUrl,
} as const;

export const analyticsConfig = {
  plausibleDomain: clean(process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN),
  googleAnalyticsId: clean(process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID),
  googleAdsId: clean(process.env.NEXT_PUBLIC_GOOGLE_ADS_ID),
  metaPixelId: clean(process.env.NEXT_PUBLIC_META_PIXEL_ID),
} as const;
