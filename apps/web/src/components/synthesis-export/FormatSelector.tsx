"use client";

import { useTranslations } from "next-intl";
import {
  synthesisFormatValues,
  synthesisTemplateValues,
} from "@opencairn/shared";

export interface FormatSelectorProps {
  format: (typeof synthesisFormatValues)[number];
  template: (typeof synthesisTemplateValues)[number];
  onFormatChange: (f: (typeof synthesisFormatValues)[number]) => void;
  onTemplateChange: (t: (typeof synthesisTemplateValues)[number]) => void;
}

export function FormatSelector({
  format,
  template,
  onFormatChange,
  onTemplateChange,
}: FormatSelectorProps) {
  const t = useTranslations("synthesisExport");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-neutral-500">
          {t("panel.format")}
        </label>
        <select
          data-testid="format-select"
          value={format}
          onChange={(e) =>
            onFormatChange(
              e.target.value as (typeof synthesisFormatValues)[number],
            )
          }
          className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {synthesisFormatValues.map((f) => (
            <option key={f} value={f}>
              {f.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-neutral-500">
          {t("panel.template")}
        </label>
        <select
          data-testid="template-select"
          value={template}
          onChange={(e) =>
            onTemplateChange(
              e.target.value as (typeof synthesisTemplateValues)[number],
            )
          }
          className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {synthesisTemplateValues.map((tv) => (
            <option key={tv} value={tv}>
              {t(`templates.${tv}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
