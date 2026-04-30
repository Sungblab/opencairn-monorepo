import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ImageElement } from "./image-element";
import koMessages from "@/../messages/ko/editor.json";

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ editor: koMessages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("ImageElement", () => {
  it("renders an img with given URL and lazy loading", () => {
    const element = {
      type: "image" as const,
      url: "https://example.com/photo.png",
      alt: "A photo",
      caption: "Sunset",
      children: [{ text: "" }] as [{ text: "" }],
    };
    const { container } = render(
      withIntl(
        // @ts-expect-error — test mock omits Plate's full editor context
        <ImageElement
          attributes={{ "data-slate-node": "element", ref: () => {} } as never}
          element={element as never}
        >
          <span />
        </ImageElement>,
      ),
    );
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img!.getAttribute("src")).toBe(element.url);
    expect(img!.getAttribute("alt")).toBe("A photo");
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(container.querySelector("figcaption")?.textContent).toBe("Sunset");
  });

  it("uses empty alt when alt is missing", () => {
    const element = {
      type: "image" as const,
      url: "https://example.com/decorative.png",
      children: [{ text: "" }] as [{ text: "" }],
    };
    const { container } = render(
      withIntl(
        // @ts-expect-error — test mock omits Plate's full editor context
        <ImageElement
          attributes={{ "data-slate-node": "element", ref: () => {} } as never}
          element={element as never}
        >
          <span />
        </ImageElement>,
      ),
    );
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("");
  });

  it("hides figcaption when caption is missing", () => {
    const element = {
      type: "image" as const,
      url: "https://example.com/photo.png",
      alt: "x",
      children: [{ text: "" }] as [{ text: "" }],
    };
    const { container } = render(
      withIntl(
        // @ts-expect-error — test mock omits Plate's full editor context
        <ImageElement
          attributes={{ "data-slate-node": "element", ref: () => {} } as never}
          element={element as never}
        >
          <span />
        </ImageElement>,
      ),
    );
    expect(container.querySelector("figcaption")).toBeNull();
  });
});
