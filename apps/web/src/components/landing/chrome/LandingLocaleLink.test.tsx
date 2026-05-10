import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandingLocaleLink } from "./LandingLocaleLink";

describe("LandingLocaleLink", () => {
  it("uses the explicit Korean href for the default landing locale", () => {
    document.cookie = "NEXT_LOCALE=; Max-Age=0; Path=/";

    render(
      <LandingLocaleLink
        locale="ko"
        ariaLabel="switch language"
        className="locale-link"
      >
        ko
      </LandingLocaleLink>,
    );

    const link = screen.getByRole("link", { name: "switch language" });
    expect(link).toHaveAttribute("href", "/ko");

    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);

    expect(document.cookie).toContain("NEXT_LOCALE=ko");
  });

  it("keeps the explicit English href because it is not the default locale", () => {
    render(
      <LandingLocaleLink
        locale="en"
        ariaLabel="switch language"
        className="locale-link"
      >
        en
      </LandingLocaleLink>,
    );

    expect(
      screen.getByRole("link", { name: "switch language" }),
    ).toHaveAttribute("href", "/en");
  });
});
