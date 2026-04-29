"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { CanvasFrame } from "@/components/canvas/CanvasFrame";

type DemoLang = "python" | "javascript" | "html" | "react";

const VALID_LANGS: DemoLang[] = ["python", "javascript", "html", "react"];

function parseLang(raw: string | null): DemoLang {
  return VALID_LANGS.includes(raw as DemoLang) ? (raw as DemoLang) : "python";
}

export default function CanvasDemoPage() {
  const t = useTranslations("canvas");
  const params = useSearchParams();

  const [language, setLanguage] = useState<DemoLang>(() =>
    parseLang(params.get("lang")),
  );
  const [source, setSource] = useState("");
  const [runId, setRunId] = useState(0);

  // Hydrate from sessionStorage on language change (debugging convenience).
  // Keys are scoped per language so swapping the dropdown doesn't clobber
  // your in-progress python while you peek at react.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = sessionStorage.getItem(`canvas-demo:${language}`);
    setSource(saved ?? "");
  }, [language]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(`canvas-demo:${language}`, source);
  }, [source, language]);

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b p-3">
        <h1 className="text-lg font-semibold">{t("demo.title")}</h1>
      </header>
      <div className="border-b p-2 flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span>{t("viewer.languageLabel")}:</span>
          <select
            name="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as DemoLang)}
            className="border rounded px-2 py-1"
          >
            <option value="python">{t("demo.languagePython")}</option>
            <option value="javascript">{t("demo.languageJavascript")}</option>
            <option value="html">{t("demo.languageHtml")}</option>
            <option value="react">{t("demo.languageReact")}</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setRunId((n) => n + 1)}
          className="px-3 py-1 rounded bg-primary text-primary-foreground"
        >
          {t("viewer.run")}
        </button>
      </div>
      <div className="flex flex-1 min-h-0">
        <textarea
          name="source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder={t("demo.sourcePlaceholder")}
          className="flex-1 p-3 font-mono text-sm bg-muted/20 border-r outline-none resize-none"
          spellCheck={false}
        />
        <div className="flex-1 p-3 overflow-auto">
          <CanvasFrame key={runId} source={source} language={language} />
        </div>
      </div>
    </div>
  );
}
