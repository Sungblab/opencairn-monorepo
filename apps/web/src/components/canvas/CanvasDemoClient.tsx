"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CanvasFrame } from "@/components/canvas/CanvasFrame";

export type DemoLang = "python" | "javascript" | "html" | "react";

export function CanvasDemoClient({ initialLang }: { initialLang: DemoLang }) {
  const t = useTranslations("canvas");
  const [language, setLanguage] = useState<DemoLang>(initialLang);
  const [source, setSource] = useState("");
  const [runId, setRunId] = useState(0);

  // Hydrate from sessionStorage on language change (debugging convenience).
  // Keys are scoped per language so swapping the dropdown doesn't clobber
  // your in-progress python while you peek at react.
  useEffect(() => {
    const saved = sessionStorage.getItem(`canvas-demo:${language}`);
    setSource(saved ?? "");
  }, [language]);

  useEffect(() => {
    sessionStorage.setItem(`canvas-demo:${language}`, source);
  }, [source, language]);

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b p-3">
        <h1 className="text-lg font-semibold">{t("demo.title")}</h1>
      </header>
      <div className="flex items-center gap-3 border-b p-2 text-sm">
        <label className="flex items-center gap-2">
          <span>{t("viewer.languageLabel")}:</span>
          <select
            name="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as DemoLang)}
            className="rounded border px-2 py-1"
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
          className="rounded bg-primary px-3 py-1 text-primary-foreground"
        >
          {t("viewer.run")}
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <textarea
          name="source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder={t("demo.sourcePlaceholder")}
          className="flex-1 resize-none border-r bg-muted/20 p-3 font-mono text-sm outline-none"
          spellCheck={false}
        />
        <div className="flex-1 overflow-auto p-3">
          <CanvasFrame key={runId} source={source} language={language} />
        </div>
      </div>
    </div>
  );
}
