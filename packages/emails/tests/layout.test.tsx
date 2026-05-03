import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Layout } from "../src/components/Layout";

describe("Layout", () => {
  it("renders preview text for inbox preview snippets", async () => {
    const html = await render(
      <Layout preview="프리뷰 텍스트">
        <p>hello</p>
      </Layout>,
    );
    expect(html).toContain("프리뷰 텍스트");
  });

  it("wraps children inside a container", async () => {
    const html = await render(
      <Layout preview="p">
        <p data-testid="child">안녕하세요</p>
      </Layout>,
    );
    expect(html).toContain("안녕하세요");
  });

  it("includes the OpenCairn wordmark in the header", async () => {
    const html = await render(
      <Layout preview="p">
        <p>x</p>
      </Layout>,
    );
    expect(html).toContain("OpenCairn");
  });

  it("includes a footer contact line", async () => {
    const html = await render(
      <Layout preview="p" contactEmail="hello@example.com">
        <p>x</p>
      </Layout>,
    );
    expect(html).toContain("hello@example.com");
  });

  it("applies the declared lang attribute", async () => {
    const html = await render(
      <Layout preview="p" lang="en">
        <p>x</p>
      </Layout>,
    );
    expect(html).toContain('lang="en"');
  });

  it("defaults lang to ko", async () => {
    const html = await render(
      <Layout preview="p">
        <p>x</p>
      </Layout>,
    );
    expect(html).toContain('lang="ko"');
  });
});
