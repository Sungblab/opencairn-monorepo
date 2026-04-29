import {
  Document, Packer, Paragraph, HeadingLevel, TextRun, Footer, PageNumber,
  AlignmentType,
} from "docx";

export interface SynthesisOutputJson {
  format: "latex" | "docx" | "pdf" | "md";
  title: string;
  abstract: string | null;
  sections: { title: string; content: string; source_ids: string[] }[];
  bibliography: {
    cite_key: string; author: string; title: string;
    year: number | null; url: string | null; source_id: string;
  }[];
  template: string;
}

// Strip a tiny HTML subset (h1/h2/p/strong/em/li/code) into plain runs.
// Production-grade HTML→DOCX is out of scope; the LLM is instructed to
// emit the supported subset.
function htmlToParagraphs(html: string): Paragraph[] {
  const stripped = html
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
  return stripped.split(/\n+/).map((line) => new Paragraph({
    children: [new TextRun({ text: line })],
  }));
}

export async function compileDocx(out: SynthesisOutputJson): Promise<Buffer> {
  const children: Paragraph[] = [];
  children.push(new Paragraph({
    text: out.title,
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
  }));

  if (out.abstract) {
    children.push(new Paragraph({ text: "Abstract", heading: HeadingLevel.HEADING_1 }));
    children.push(...htmlToParagraphs(out.abstract));
  }

  for (const sec of out.sections) {
    children.push(new Paragraph({ text: sec.title, heading: HeadingLevel.HEADING_1 }));
    children.push(...htmlToParagraphs(sec.content));
  }

  if (out.bibliography.length > 0) {
    children.push(new Paragraph({ text: "References", heading: HeadingLevel.HEADING_1 }));
    out.bibliography.forEach((b, i) => {
      const yr = b.year ? `, ${b.year}` : "";
      const url = b.url ? `, ${b.url}` : "";
      children.push(new Paragraph({
        children: [new TextRun({ text: `[${i + 1}] ${b.author}, “${b.title}”${yr}${url}` })],
      }));
    });
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children,
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES] })],
          })],
        }),
      },
    }],
  });
  return Packer.toBuffer(doc);
}
