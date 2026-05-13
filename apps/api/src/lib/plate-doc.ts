export type PlateValue = Array<Record<string, unknown>>;
type PlateNode = Record<string, unknown> & {
  type?: string;
  children?: PlateNode[];
  text?: string;
  lang?: string;
};

const MARKDOWN_SIGNIFICANT_ESCAPES = /\\([*_#\[\]()`!.>|~\\-])/g;

export function textToPlateValue(text: string): PlateValue {
  return [{ type: "p", children: [{ text }] }];
}

export function markdownToPlateValue(markdown: string): PlateValue {
  if (!markdown.trim()) return textToPlateValue("");

  const lines = normalizeMarkdownBlocks(markdown).split("\n");
  const nodes: PlateNode[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    nodes.push({
      type: "p",
      children: parseInlineMarkdown(paragraph.join("\n")),
    });
    paragraph = [];
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const embeddedTableStart = findEmbeddedTableStart(lines, i);
    if (embeddedTableStart !== null) {
      const beforeTable = line.slice(0, embeddedTableStart).trimEnd();
      const embeddedHeading = beforeTable.match(/^(#{1,3})\s+(.+)$/);
      if (embeddedHeading) {
        flushParagraph();
        nodes.push({
          type: `h${embeddedHeading[1].length}`,
          children: parseInlineMarkdown(embeddedHeading[2]),
        });
      } else if (beforeTable) {
        paragraph.push(beforeTable);
      }
      lines[i] = line.slice(embeddedTableStart);
    }

    const table = parseTableAt(lines, i);
    if (table) {
      flushParagraph();
      nodes.push(table.node);
      i = table.nextIndex - 1;
      continue;
    }

    const fence = trimmed.match(/^```(\w+)?\s*$/);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test((lines[i] ?? "").trim())) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      nodes.push({
        type: "code_block",
        lang: fence[1] ?? undefined,
        children: [{ type: "code_line", children: [{ text: body.join("\n") }] }],
      });
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      flushParagraph();
      nodes.push({ type: "hr", children: [{ text: "" }] });
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      nodes.push({
        type: `h${heading[1].length}`,
        children: parseInlineMarkdown(heading[2]),
      });
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      nodes.push({
        type: "p",
        listStyleType: "disc",
        indent: 1,
        children: parseInlineMarkdown(bullet[1]),
      });
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      nodes.push({
        type: "p",
        listStyleType: "decimal",
        indent: 1,
        children: parseInlineMarkdown(ordered[1]),
      });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return (nodes.length ? nodes : textToPlateValue("")) as PlateValue;
}

function findEmbeddedTableStart(lines: string[], index: number): number | null {
  const line = lines[index] ?? "";
  const separator = lines[index + 1]?.trim() ?? "";
  if (!isTableSeparator(separator)) return null;
  const firstPipe = line.indexOf("|");
  if (firstPipe <= 0) return null;
  const headerCells = splitTableRow(line.slice(firstPipe));
  return headerCells.length >= 2 ? firstPipe : null;
}

function normalizeMarkdownBlocks(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+---(?=[ \t\n]|$)/g, "\n\n---")
    .replace(/(\|[^\n]*?\|)[ \t]+(?=\|[ \t]*:?-{3})/g, "$1\n")
    .replace(/(\|[ \t]*:?-{3}[^\n]*?\|)[ \t]+(?=\|)/g, "$1\n")
    .replace(/[ \t]+(#{1,3}\s+)/g, "\n\n$1");
}

function parseTableAt(
  lines: string[],
  index: number,
): { node: PlateNode; nextIndex: number } | null {
  const header = lines[index]?.trim() ?? "";
  const separator = lines[index + 1]?.trim() ?? "";
  if (!header.includes("|") || !isTableSeparator(separator)) return null;

  const headerCells = splitTableRow(header);
  const columnCount = headerCells.length;
  if (columnCount < 2) return null;
  const rows = [headerCells];
  let cursor = index + 2;
  while (cursor < lines.length) {
    const line = lines[cursor]?.trim() ?? "";
    if (!line || !line.includes("|")) break;
    const rowBatch = splitTableRows(line, columnCount);
    if (!rowBatch) break;
    rows.push(...rowBatch.rows);
    if (rowBatch.trailingText) {
      lines[cursor] = rowBatch.trailingText;
      break;
    }
    cursor += 1;
  }

  if (rows.length < 2 || rows.some((row) => row.length !== columnCount)) return null;

  return {
    node: {
      type: "table",
      children: rows.map((row, rowIndex) => ({
        type: "tr",
        children: row.map((cell) => ({
          type: rowIndex === 0 ? "th" : "td",
          children: [{ type: "p", children: parseInlineMarkdown(cell) }],
        })),
      })),
    },
    nextIndex: cursor,
  };
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function splitTableRows(
  line: string,
  columnCount: number,
): { rows: string[][]; trailingText: string | null } | null {
  const cells = splitTableRow(line);
  if (cells.length < columnCount) return null;
  const rows: string[][] = [];
  let i = 0;
  while (i + columnCount <= cells.length) {
    rows.push(cells.slice(i, i + columnCount));
    i += columnCount;
    if (cells[i] === "" && cells.length - i - 1 >= columnCount) {
      i += 1;
    }
  }
  const trailingText = cells.slice(i).join(" | ").trim() || null;
  return { rows, trailingText };
}

function parseInlineMarkdown(text: string): PlateNode[] {
  const nodes: PlateNode[] = [];
  const pattern = /(\[\[([^\]\n]+)\]\]|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\$([^$\n]+)\$)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push({ text: normalizeEscapes(text.slice(cursor, match.index)) });
    if (match[2]) nodes.push(markdownWikiLinkNode(match[2]));
    else if (match[3]) nodes.push({ text: normalizeEscapes(match[3]), bold: true });
    else if (match[4]) nodes.push({ text: normalizeEscapes(match[4]), italic: true });
    else if (match[5]) nodes.push({ text: normalizeEscapes(match[5]), code: true });
    else if (match[6]) {
      nodes.push({
        type: "inline_equation",
        texExpression: normalizeEscapes(match[6]),
        children: [{ text: "" }],
      });
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) nodes.push({ text: normalizeEscapes(text.slice(cursor)) });
  return nodes.length ? nodes : [{ text: "" }];
}

function markdownWikiLinkNode(rawTarget: string): PlateNode {
  const [target, alias] = rawTarget.split("|", 2).map((part) => normalizeEscapes(part.trim()));
  const label = target || alias || "Untitled";
  const display = alias || label;
  return {
    type: "wikilink",
    noteId: null,
    label,
    children: [{ text: display }],
  };
}

function normalizeEscapes(input: string): string {
  return input
    .replace(MARKDOWN_SIGNIFICANT_ESCAPES, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}
