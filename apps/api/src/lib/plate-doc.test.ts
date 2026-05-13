import { describe, expect, it } from "vitest";
import { extractWikiLinkReferences } from "@opencairn/db";
import { markdownToPlateValue, textToPlateValue } from "./plate-doc";

describe("textToPlateValue", () => {
  it("stores generated source note content as a Plate value array", () => {
    const value = textToPlateValue("# PDF title\n\nExtracted body");

    expect(Array.isArray(value)).toBe(true);
    expect(value).toEqual([
      {
        type: "p",
        children: [{ text: "# PDF title\n\nExtracted body" }],
      },
    ]);
  });
});

describe("markdownToPlateValue", () => {
  it("converts markdown headings and inline marks to Plate nodes", () => {
    const value = markdownToPlateValue("# PDF title\n\n**bold** and *italic*");

    expect(value[0]).toMatchObject({
      type: "h1",
      children: [{ text: "PDF title" }],
    });
    expect(value[1]).toMatchObject({
      type: "p",
      children: [
        { text: "bold", bold: true },
        { text: " and " },
        { text: "italic", italic: true },
      ],
    });
  });

  it("converts pipe tables into editable Plate table nodes", () => {
    const value = markdownToPlateValue([
      "| 2진수 | 부호와 절대치 | 1의 보수 |",
      "| :--- | :--- | :--- |",
      "| 00000000 | +0 | +0 |",
    ].join("\n"));

    expect(value).toEqual([
      {
        type: "table",
        children: [
          {
            type: "tr",
            children: [
              { type: "th", children: [{ type: "p", children: [{ text: "2진수" }] }] },
              { type: "th", children: [{ type: "p", children: [{ text: "부호와 절대치" }] }] },
              { type: "th", children: [{ type: "p", children: [{ text: "1의 보수" }] }] },
            ],
          },
          {
            type: "tr",
            children: [
              { type: "td", children: [{ type: "p", children: [{ text: "00000000" }] }] },
              { type: "td", children: [{ type: "p", children: [{ text: "+0" }] }] },
              { type: "td", children: [{ type: "p", children: [{ text: "+0" }] }] },
            ],
          },
        ],
      },
    ]);
  });

  it("recovers block structure from flattened PDF markdown text", () => {
    const value = markdownToPlateValue(
      "# 제목 **학교** --- ## 복습 ### 표 설명 | A | B | | :--- | :--- | | 1 | 2 |",
    );

    expect(value.map((node) => node.type)).toEqual(["h1", "hr", "h2", "h3", "table"]);
    expect(value[4]).toMatchObject({
      type: "table",
      children: expect.arrayContaining([
        {
          type: "tr",
          children: [
            { type: "th", children: [{ type: "p", children: [{ text: "A" }] }] },
            { type: "th", children: [{ type: "p", children: [{ text: "B" }] }] },
          ],
        },
      ]),
    });
  });

  it("recovers a pipe table when prose appears immediately before it", () => {
    const value = markdownToPlateValue(
      "설명 문장입니다. **<2진수의 표현 방법 3가지 (8bit)>** | 2진수 | 부호와 절대치 | 1의 보수 |\n| :--- | :--- | :--- |\n| 00000000 | +0 | +0 |",
    );

    expect(value.map((node) => node.type)).toEqual(["p", "table"]);
    expect(value[1]).toEqual({
      type: "table",
      children: [
        {
          type: "tr",
          children: [
            { type: "th", children: [{ type: "p", children: [{ text: "2진수" }] }] },
            { type: "th", children: [{ type: "p", children: [{ text: "부호와 절대치" }] }] },
            { type: "th", children: [{ type: "p", children: [{ text: "1의 보수" }] }] },
          ],
        },
        {
          type: "tr",
          children: [
            { type: "td", children: [{ type: "p", children: [{ text: "00000000" }] }] },
            { type: "td", children: [{ type: "p", children: [{ text: "+0" }] }] },
            { type: "td", children: [{ type: "p", children: [{ text: "+0" }] }] },
          ],
        },
      ],
    });
  });

  it("converts dollar-delimited inline math into inline equation nodes", () => {
    const value = markdownToPlateValue(
      "컴파일러 $\\rightarrow$ 어셈블리 코드",
    );

    expect(value[0]).toMatchObject({
      type: "p",
      children: [
        { text: "컴파일러 " },
        {
          type: "inline_equation",
          texExpression: "\\rightarrow",
          children: [{ text: "" }],
        },
        { text: " 어셈블리 코드" },
      ],
    });
  });

  it("converts markdown wiki links into title-resolvable Plate wiki-link nodes", () => {
    const value = markdownToPlateValue(
      "운영체제는 [[프로세스 (Process)|프로세스]]와 [[가상 메모리]]를 관리합니다.",
    );

    expect(value[0]).toMatchObject({
      type: "p",
      children: [
        { text: "운영체제는 " },
        {
          type: "wikilink",
          noteId: null,
          label: "프로세스 (Process)",
          children: [{ text: "프로세스" }],
        },
        { text: "와 " },
        {
          type: "wikilink",
          noteId: null,
          label: "가상 메모리",
          children: [{ text: "가상 메모리" }],
        },
        { text: "를 관리합니다." },
      ],
    });
    expect(extractWikiLinkReferences(value).targetTitles).toEqual(
      new Set(["프로세스 (Process)", "가상 메모리"]),
    );
  });

  it("chunks flattened table data rows by the header column count", () => {
    const value = markdownToPlateValue(
      "<2진수의 표현 방법 3가지 (8bit)> | 2진수 | 부호와 절대치 | 1의 보수 | 2의 보수 |\n| :--- | :--- | :--- | :--- |\n| 00000000 | +0 | +0 | +0 | | 00000001 | +1 | +1 | +1 |",
    );

    expect(value.map((node) => node.type)).toEqual(["p", "table"]);
    expect((value[1].children as Array<{ children: unknown[] }>)).toHaveLength(3);
    expect(value[1]).toMatchObject({
      type: "table",
      children: [
        expect.objectContaining({ type: "tr" }),
        {
          type: "tr",
          children: [
            { type: "td", children: [{ type: "p", children: [{ text: "00000000" }] }] },
            { type: "td", children: [{ type: "p", children: [{ text: "+0" }] }] },
            { type: "td", children: [{ type: "p", children: [{ text: "+0" }] }] },
            { type: "td", children: [{ type: "p", children: [{ text: "+0" }] }] },
          ],
        },
        {
          type: "tr",
          children: [
            { type: "td", children: [{ type: "p", children: [{ text: "00000001" }] }] },
            { type: "td", children: [{ type: "p", children: [{ text: "+1" }] }] },
            { type: "td", children: [{ type: "p", children: [{ text: "+1" }] }] },
            { type: "td", children: [{ type: "p", children: [{ text: "+1" }] }] },
          ],
        },
      ],
    });
  });

  it("preserves intentionally empty table cells", () => {
    const value = markdownToPlateValue([
      "| 개념 | 설명 | 비고 |",
      "| :--- | :--- | :--- |",
      "| VCS |  | Git 포함 |",
    ].join("\n"));

    expect(value).toEqual([
      {
        type: "table",
        children: [
          {
            type: "tr",
            children: [
              { type: "th", children: [{ type: "p", children: [{ text: "개념" }] }] },
              { type: "th", children: [{ type: "p", children: [{ text: "설명" }] }] },
              { type: "th", children: [{ type: "p", children: [{ text: "비고" }] }] },
            ],
          },
          {
            type: "tr",
            children: [
              { type: "td", children: [{ type: "p", children: [{ text: "VCS" }] }] },
              { type: "td", children: [{ type: "p", children: [{ text: "" }] }] },
              { type: "td", children: [{ type: "p", children: [{ text: "Git 포함" }] }] },
            ],
          },
        ],
      },
    ]);
  });

  it("keeps prose after a flattened table as the next paragraph", () => {
    const value = markdownToPlateValue(
      "설명 | A | B |\n| :--- | :--- |\n| 1 | 2 | | 3 | 4 | trailing prose",
    );

    expect(value.map((node) => node.type)).toEqual(["p", "table", "p"]);
    expect(value[1]).toMatchObject({
      type: "table",
      children: [
        expect.objectContaining({ type: "tr" }),
        expect.objectContaining({ type: "tr" }),
        expect.objectContaining({ type: "tr" }),
      ],
    });
    expect(value[2]).toMatchObject({
      type: "p",
      children: [{ text: "trailing prose" }],
    });
  });
});
