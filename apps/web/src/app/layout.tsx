import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme/provider";
import { THEME_COOKIE, themeFromCookieValue } from "@/lib/theme/cookie";

export const metadata: Metadata = {
  title: "OpenCairn",
  description: "AI knowledge base for learning, research, and work.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const theme = themeFromCookieValue(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <html lang="ko" data-theme={theme}>
      <body className="bg-bg text-fg antialiased">
        <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
