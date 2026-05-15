import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import authMessages from "../../../messages/ko/auth.json";
import { GoogleButton, resolveAuthCallbackOrigin } from "./GoogleButton";

const { socialSignIn } = vi.hoisted(() => ({
  socialSignIn: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      social: socialSignIn,
    },
  },
  googleOAuthEnabled: true,
}));

vi.mock("@/lib/site-config", () => ({
  siteUrl: "https://opencairn.com",
}));

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  return {
    ...actual,
    useLocale: () => "ko",
  };
});

function renderButton() {
  return render(
    <NextIntlClientProvider locale="ko" messages={{ auth: authMessages }}>
      <GoogleButton />
    </NextIntlClientProvider>,
  );
}

describe("GoogleButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    socialSignIn.mockReset();
    window.history.replaceState({}, "", "http://localhost:3000/");
  });

  it("starts Google OAuth in regular browsers", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
    );

    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));

    expect(socialSignIn).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "http://localhost:3000/ko/dashboard",
    });
  });

  it("uses the canonical site URL when the browser origin is an unspecified bind address", () => {
    expect(
      resolveAuthCallbackOrigin(
        "https://0.0.0.0:3000",
        "0.0.0.0",
        "https://opencairn.com",
      ),
    ).toBe("https://opencairn.com");
  });

  it("keeps regular browser origins for local development and previews", () => {
    expect(
      resolveAuthCallbackOrigin(
        "http://localhost:3000",
        "localhost",
        "https://opencairn.com",
      ),
    ).toBe("http://localhost:3000");
    expect(
      resolveAuthCallbackOrigin(
        "https://preview.opencairn.example",
        "preview.opencairn.example",
        "https://opencairn.com",
      ),
    ).toBe("https://preview.opencairn.example");
  });

  it("falls back to the current origin when the canonical site URL is invalid", () => {
    expect(
      resolveAuthCallbackOrigin(
        "https://0.0.0.0:3000",
        "0.0.0.0",
        "not a url",
      ),
    ).toBe("https://0.0.0.0:3000");
  });

  it("starts Google OAuth from the canonical site URL when opened through an unspecified bind address", async () => {
    vi.spyOn(window, "location", "get").mockReturnValue(
      new URL("https://0.0.0.0:3000/ko/auth/login") as unknown as Location,
    );
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
    );

    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));

    expect(socialSignIn).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "https://opencairn.com/ko/dashboard",
    });
  });

  it("blocks Google OAuth and shows external-browser guidance in in-app browsers", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 312.0",
    );

    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));

    expect(socialSignIn).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "외부 브라우저에서 열어주세요",
    );
  });
});
