const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, "");
};

export const siteUrl =
  clean(process.env.NEXT_PUBLIC_SITE_URL) ??
  clean(process.env.NEXT_PUBLIC_BASE_URL) ??
  "https://opencairn.com";

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

export const analyticsConfig = {
  plausibleDomain: clean(process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN),
  googleAnalyticsId: clean(process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID),
  googleAdsId: clean(process.env.NEXT_PUBLIC_GOOGLE_ADS_ID),
  metaPixelId: clean(process.env.NEXT_PUBLIC_META_PIXEL_ID),
} as const;
