import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EmbedElement } from "./embed-element";

// EmbedElement has no i18n strings — it renders only an iframe with
// data from the node. No NextIntlClientProvider wrapper needed.

describe("EmbedElement", () => {
  it("renders an iframe with the embedUrl", () => {
    const element = {
      type: "embed" as const,
      provider: "youtube" as const,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      children: [{ text: "" }] as [{ text: "" }],
    };
    const { container } = render(
      // @ts-expect-error — test mock omits Plate's full editor context
      <EmbedElement
        attributes={{ "data-slate-node": "element", ref: () => {} } as never}
        element={element as never}
      >
        <span />
      </EmbedElement>,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe).toBeTruthy();
    expect(iframe!.src).toBe(element.embedUrl);
    expect(iframe!.getAttribute("sandbox")).toContain("allow-scripts");
    expect(iframe!.getAttribute("loading")).toBe("lazy");
  });

  it("uses the provider as the iframe title", () => {
    const element = {
      type: "embed" as const,
      provider: "vimeo" as const,
      url: "https://vimeo.com/123456789",
      embedUrl: "https://player.vimeo.com/video/123456789",
      children: [{ text: "" }] as [{ text: "" }],
    };
    const { container } = render(
      // @ts-expect-error — test mock omits Plate's full editor context
      <EmbedElement
        attributes={{ "data-slate-node": "element", ref: () => {} } as never}
        element={element as never}
      >
        <span />
      </EmbedElement>,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe!.title).toBe("vimeo embed");
  });

  it("includes sandboxing and referrer policy attributes", () => {
    const element = {
      type: "embed" as const,
      provider: "loom" as const,
      url: "https://www.loom.com/share/abc123def456",
      embedUrl: "https://www.loom.com/embed/abc123def456",
      children: [{ text: "" }] as [{ text: "" }],
    };
    const { container } = render(
      // @ts-expect-error — test mock omits Plate's full editor context
      <EmbedElement
        attributes={{ "data-slate-node": "element", ref: () => {} } as never}
        element={element as never}
      >
        <span />
      </EmbedElement>,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe!.getAttribute("referrerpolicy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(iframe!.getAttribute("sandbox")).toContain("allow-same-origin");
    expect(iframe!.getAttribute("sandbox")).toContain("allow-presentation");
  });
});
