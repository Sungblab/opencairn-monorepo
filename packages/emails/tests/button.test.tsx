import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Button } from "../src/components/Button";
import { colors } from "../src/components/tokens";

describe("Button", () => {
  it("renders an anchor with the provided href and label", async () => {
    const html = await render(<Button href="https://opencairn.com/accept">초대 수락하기</Button>);
    expect(html).toContain('href="https://opencairn.com/accept"');
    expect(html).toContain("초대 수락하기");
  });

  it("applies the primary fill color from tokens", async () => {
    const html = await render(<Button href="https://x">go</Button>);
    // Assert against token values directly so the test stays green when
    // tokens.ts changes and fails only if the Button stops consuming them.
    expect(html).toContain(colors.primary);
    expect(html).toContain(colors.primaryText);
  });
});
