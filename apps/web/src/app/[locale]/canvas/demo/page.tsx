import { CanvasDemoLoader } from "@/components/canvas/CanvasDemoLoader";
import type { DemoLang } from "@/components/canvas/CanvasDemoClient";

const VALID_LANGS: DemoLang[] = ["python", "javascript", "html", "react"];

function parseLang(raw: string | string[] | undefined): DemoLang {
  if (Array.isArray(raw)) return parseLang(raw[0]);
  return VALID_LANGS.includes(raw as DemoLang) ? (raw as DemoLang) : "python";
}

export default async function CanvasDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const query = await searchParams;
  return <CanvasDemoLoader initialLang={parseLang(query.lang)} />;
}
