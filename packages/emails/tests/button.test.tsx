import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Button } from "../src/components/Button";

describe("Button", () => {
  it("renders an anchor with the provided href and label", async () => {
    const html = await render(<Button href="https://opencairn.com/accept">초대 수락하기</Button>);
    expect(html).toContain('href="https://opencairn.com/accept"');
    expect(html).toContain("초대 수락하기");
  });

  it("applies the primary fill color from tokens", async () => {
    const html = await render(<Button href="https://x">go</Button>);
    // Primary token — keep in sync with tokens.ts
    expect(html).toContain("#111111");
    expect(html).toContain("#ffffff");
  });
});
