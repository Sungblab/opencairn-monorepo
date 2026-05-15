const IN_APP_BROWSER_TOKENS = [
  "FBAN",
  "FBAV",
  "FB_IAB",
  "Instagram",
  "Line/",
  "KAKAOTALK",
  "NAVER",
  "Twitter",
  "LinkedInApp",
  "TikTok",
  "MicroMessenger",
  "Snapchat",
];

export function isLikelyInAppBrowser(userAgent: string): boolean {
  const ua = userAgent.trim();
  if (!ua) return false;

  if (IN_APP_BROWSER_TOKENS.some((token) => ua.includes(token))) {
    return true;
  }

  const isAndroidWebView = /\bwv\b/.test(ua) || ua.includes("; wv)");
  const isIosWebView =
    /\b(iPhone|iPad|iPod)\b/.test(ua) &&
    ua.includes("AppleWebKit") &&
    !ua.includes("Safari/");

  return isAndroidWebView || isIosWebView;
}

export function currentPageExternalBrowserUrl(): string {
  if (typeof window === "undefined") return "";
  return window.location.href;
}
