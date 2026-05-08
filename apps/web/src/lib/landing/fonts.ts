import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";

// Self-hosted Pretendard Variable (npm `pretendard@1.3.9`). woff2 file is
// vendored into ./fonts/ so next/font can fingerprint and cache-bust it.
// `weight: '45 920'` maps the full variable axis range — required to avoid
// WebKit rendering wrong weights (per Pretendard docs).
export const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  display: "swap",
  weight: "45 920",
  variable: "--font-pretendard",
});

// Used ONLY for the OpenCairn wordmark in headers/footers/auth chrome.
// All headlines, prices, and body text use Pretendard via --font-sans.
export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif-raw",
  display: "swap",
  preload: false,
});

export const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans-raw",
  display: "swap",
  preload: false,
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-raw",
  display: "swap",
  preload: false,
});
