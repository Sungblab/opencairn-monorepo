import { describe, expect, it } from "vitest";
import { buildSandboxHTML } from "./sandbox-html-template";

describe("buildSandboxHTML", () => {
  it("html mode returns input verbatim", () => {
    const html = "<h1>hi</h1>";
    expect(buildSandboxHTML(html, "html")).toBe(html);
  });

  it("javascript mode wraps in <script type=module> with #root container", () => {
    const out = buildSandboxHTML("console.log('x');", "javascript");
    expect(out).toContain('<script type="module">');
    expect(out).toContain("console.log('x');");
    expect(out).toContain('<div id="root"></div>');
  });

  it("react mode emits esm.sh import map pinning react@19 + react-dom@19/client", () => {
    const out = buildSandboxHTML("export default function App() { return null; }", "react");
    expect(out).toContain('"react": "https://esm.sh/react@19"');
    expect(out).toContain('"react-dom/client": "https://esm.sh/react-dom@19/client"');
    expect(out).toContain("createRoot");
  });

  it("react mode pins versions (no floating 'latest' or unpinned react@)", () => {
    const out = buildSandboxHTML("x", "react");
    expect(out).not.toMatch(/esm\.sh\/react@(?!19)/);
    expect(out).not.toContain("latest");
  });
});
