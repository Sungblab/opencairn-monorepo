import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { FormatSelector } from "../FormatSelector";
import messages from "../../../../messages/ko/synthesis-export.json";

function setup(
  overrides: Partial<Parameters<typeof FormatSelector>[0]> = {},
) {
  const onFormatChange = vi.fn();
  const onTemplateChange = vi.fn();
  return {
    onFormatChange,
    onTemplateChange,
    ...render(
      <NextIntlClientProvider locale="ko" messages={{ synthesisExport: messages }}>
        <FormatSelector
          format="latex"
          template="ieee"
          onFormatChange={onFormatChange}
          onTemplateChange={onTemplateChange}
          {...overrides}
        />
      </NextIntlClientProvider>,
    ),
  };
}

describe("FormatSelector", () => {
  it("renders all 4 format options and all 5 template options", () => {
    setup();

    // 4 formats: latex, docx, pdf, md
    expect(screen.getByRole("option", { name: "LATEX" })).toBeDefined();
    expect(screen.getByRole("option", { name: "DOCX" })).toBeDefined();
    expect(screen.getByRole("option", { name: "PDF" })).toBeDefined();
    expect(screen.getByRole("option", { name: "MD" })).toBeDefined();

    // 5 templates from ko messages
    expect(screen.getByRole("option", { name: "IEEE 학술 논문" })).toBeDefined();
    expect(screen.getByRole("option", { name: "ACM 학술 논문" })).toBeDefined();
    expect(screen.getByRole("option", { name: "APA 형식" })).toBeDefined();
    expect(screen.getByRole("option", { name: "한국 학위논문" })).toBeDefined();
    expect(screen.getByRole("option", { name: "일반 보고서" })).toBeDefined();
  });

  it("calls onFormatChange when format select changes to latex", () => {
    const { onFormatChange } = setup({ format: "docx" });
    const formatSelect = screen.getByTestId("format-select");
    fireEvent.change(formatSelect, { target: { value: "latex" } });
    expect(onFormatChange).toHaveBeenCalledWith("latex");
  });
});
