import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import koAccount from "../../../../messages/ko/account.json";
import koAccountNotifications from "../../../../messages/ko/account-notifications.json";
import { LanguageRegionView } from "./language-region-view";

vi.mock("next/navigation", () => ({
  usePathname: () => "/ko/settings/personal/language",
}));

type MockLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
};

vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...props }: MockLinkProps) => (
    <a
      href={href}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>(
    "@/lib/api-client",
  );
  return {
    ...actual,
    notificationPreferencesApi: {
      profile: vi.fn().mockResolvedValue({ locale: "ko", timezone: "Asia/Seoul" }),
      updateProfile: vi.fn(),
    },
  };
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider
      locale="ko"
      messages={{
        account: koAccount,
        accountNotifications: koAccountNotifications,
      }}
    >
      <QueryClientProvider client={qc}>
        <LanguageRegionView />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("LanguageRegionView", () => {
  it("persists the selected app locale cookie from account settings", () => {
    document.cookie = "NEXT_LOCALE=; Max-Age=0; Path=/";
    setup();

    fireEvent.click(screen.getByRole("link", { name: /English/ }));

    expect(document.cookie).toContain("NEXT_LOCALE=en");
  });
});
