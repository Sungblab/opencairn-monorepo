import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "https://opencairn.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Plan 9a phase: en not translated, block search. Flip to allow at v0.1 launch.
        disallow: ["/en", "/api/"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
