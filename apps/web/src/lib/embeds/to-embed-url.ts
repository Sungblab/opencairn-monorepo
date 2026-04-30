// Plan 2E Phase B — pure URL-to-embed-URL transform for the 3 supported
// video providers (YouTube, Vimeo, Loom). Returns null for unknown hosts,
// malformed URLs, or URLs that match a host but lack a parseable video ID.
//
// `embedUrl` is the computed iframe src; it is NEVER user-supplied.
// The caller (paste handler, embed insert popover) passes the original URL
// and uses `embedUrl` for the iframe only.

export type EmbedProvider = "youtube" | "vimeo" | "loom";

export interface EmbedResolution {
  provider: EmbedProvider;
  embedUrl: string;
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);
// YouTube video IDs are exactly 11 chars: alphanumeric + _ + -
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com"]);
// Vimeo video IDs are purely numeric
const VIMEO_ID_RE = /^\d+$/;

const LOOM_HOSTS = new Set(["loom.com", "www.loom.com"]);
// Loom share IDs are hex-like, at least 8 chars
const LOOM_ID_RE = /^[A-Za-z0-9]{8,}$/;

/**
 * Convert a user-supplied video URL to the corresponding embed URL.
 * Returns `null` if the URL is not from a supported provider or cannot
 * be parsed into a valid video ID.
 */
export function toEmbedUrl(input: string): EmbedResolution | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  // Only http/https — reject javascript:, data:, blob:, etc.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();

  // ─── YouTube ────────────────────────────────────────────────────────────
  if (YOUTUBE_HOSTS.has(host)) {
    let videoId: string | null = null;
    if (host === "youtu.be") {
      // Short URL: youtu.be/<id>
      videoId = url.pathname.slice(1).split("/")[0] || null;
    } else if (url.pathname === "/watch") {
      // Standard URL: youtube.com/watch?v=<id>
      videoId = url.searchParams.get("v");
    }
    if (videoId && YOUTUBE_ID_RE.test(videoId)) {
      return {
        provider: "youtube",
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      };
    }
    return null;
  }

  // ─── Vimeo ───────────────────────────────────────────────────────────────
  if (VIMEO_HOSTS.has(host)) {
    const segments = url.pathname.split("/").filter(Boolean);
    // First segment must be a numeric ID; a hash segment (second) is stripped
    if (segments.length >= 1 && VIMEO_ID_RE.test(segments[0])) {
      return {
        provider: "vimeo",
        embedUrl: `https://player.vimeo.com/video/${segments[0]}`,
      };
    }
    return null;
  }

  // ─── Loom ────────────────────────────────────────────────────────────────
  if (LOOM_HOSTS.has(host)) {
    const segments = url.pathname.split("/").filter(Boolean);
    // Must be /share/<id>
    if (
      segments.length >= 2 &&
      segments[0] === "share" &&
      LOOM_ID_RE.test(segments[1])
    ) {
      return {
        provider: "loom",
        embedUrl: `https://www.loom.com/embed/${segments[1]}`,
      };
    }
    return null;
  }

  return null;
}
