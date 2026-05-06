import "katex/dist/katex.min.css";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme/provider";
import { THEME_COOKIE, themeFromCookieValue } from "@/lib/theme/cookie";
import { instrumentSerif, inter, jetbrainsMono, pretendard } from "@/lib/landing/fonts";
import { siteConfig, siteUrl } from "@/lib/site-config";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: `${siteConfig.name} — AI Knowledge OS`,
  description:
    siteConfig.descriptionKo ??
    "파일과 노트를 AI 워크플로로 엮고, 근거와 연결을 함께 보여 주는 개인·팀 지식 OS. Docker 셀프호스팅 · AGPLv3 + 상용 라이선스.",
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
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
