import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "https://opencairn.com";

export default function sitemap(): MetadataRoute.Sitemap {
  // Plan 9a phase: ko only. /en added when translation batch pass completes at v0.1 launch.
  return [
    { url: `${BASE}/`, lastModified: new Date(), priority: 1.0 },
    { url: `${BASE}/privacy`, lastModified: new Date(), priority: 0.2 },
    { url: `${BASE}/terms`, lastModified: new Date(), priority: 0.2 },
    { url: `${BASE}/refund`, lastModified: new Date(), priority: 0.2 },
  ];
}
