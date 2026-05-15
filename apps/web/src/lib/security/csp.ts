interface BuildCspHeaderOptions {
  hocuspocusUrl?: string | null;
}

function toOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function buildCspHeader({
  hocuspocusUrl,
}: BuildCspHeaderOptions = {}): string {
  const hocuspocusOrigin = toOrigin(hocuspocusUrl);
  const connectSrc = [
    "'self'",
    "https://esm.sh",
    "https://cdn.jsdelivr.net",
    "https://cloudflareinsights.com",
    "https://accounts.google.com",
    hocuspocusOrigin,
  ].filter(Boolean);

  return [
    "default-src 'self'",
    "frame-src 'self' blob: https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com https://accounts.google.com",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net/pyodide/ https://esm.sh https://static.cloudflareinsights.com https://accounts.google.com",
    "worker-src 'self' blob:",
    `connect-src ${connectSrc.join(" ")}`,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline'",
  ].join("; ");
}
