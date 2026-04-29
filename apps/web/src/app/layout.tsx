import "katex/dist/katex.min.css";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme/provider";
import { THEME_COOKIE, themeFromCookieValue } from "@/lib/theme/cookie";
import { instrumentSerif, inter, jetbrainsMono, pretendard } from "@/lib/landing/fonts";
import { siteUrl } from "@/lib/site-config";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "OpenCairn — AI Knowledge OS",
  description:
    "12개의 AI 에이전트가 PDF·논문·영상·팟캐스트를 위키로 엮고, 연결을 먼저 발견하며, 이해의 깊이를 스스로 측정합니다. Docker 셀프호스팅, AGPLv3.",
  openGraph: {
    type: "website",
    siteName: "OpenCairn",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const theme = themeFromCookieValue(cookieStore.get(THEME_COOKIE)?.value);
  const locale = cookieStore.get("NEXT_LOCALE")?.value === "en" ? "en" : "ko";

  return (
    <html
      lang={locale}
      data-theme={theme}
      className={`${pretendard.variable} ${instrumentSerif.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-bg text-fg antialiased">
        <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
