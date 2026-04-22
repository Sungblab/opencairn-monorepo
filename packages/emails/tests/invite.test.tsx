import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { InviteEmail } from "../src/templates/invite";

describe("InviteEmail", () => {
  const baseProps = {
    inviter: "김개발",
    signupUrl: "https://opencairn.com/ko/auth/signup?invite=abc123",
  };

  it("renders the inviter's name in the body", async () => {
    const html = await render(<InviteEmail {...baseProps} />);
    expect(html).toContain("김개발");
  });

  it("puts the signupUrl on the CTA href", async () => {
    const html = await render(<InviteEmail {...baseProps} />);
    expect(html).toContain('href="https://opencairn.com/ko/auth/signup?invite=abc123"');
  });

  it("repeats the signupUrl as plain text for link fallback", async () => {
    // If the button link doesn't render (e.g., text-only clients),
    // the raw URL must still be copy-pasteable from the body.
    const html = await render(<InviteEmail {...baseProps} />);
    const url = "https://opencairn.com/ko/auth/signup?invite=abc123";
    const count = (html.match(new RegExp(url.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g")) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("escapes HTML in the inviter name (XSS defense)", async () => {
    const html = await render(
      <InviteEmail inviter={'<script>alert(1)</script>'} signupUrl="https://x" />,
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("uses Korean honorific copy", async () => {
    const html = await render(<InviteEmail {...baseProps} />);
    expect(html).toContain("초대");
    // 존댓말 — "초대하셨습니다" or "초대했습니다" etc.
    expect(html).toMatch(/하(셨|였|했)습니다/);
  });

  it("includes preview text mentioning the inviter", async () => {
    const html = await render(<InviteEmail {...baseProps} />);
    // Preview text lives in a hidden <div> at the top of the body.
    expect(html).toContain("김개발");
    expect(html).toContain("워크스페이스");
  });
});
