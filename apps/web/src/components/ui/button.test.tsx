import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("applies hover styling to the button itself for the default variant", () => {
    render(<Button>Save</Button>);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("hover:bg-primary");
    expect(button.className).not.toContain("[a]:hover");
  });
});
