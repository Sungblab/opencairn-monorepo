import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { ToolTemplate, TemplateContext, TemplateOutput } from "./types.js";
import { schemaRegistry } from "./schemas/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "../templates");

const KNOWN_IDS = [
  "quiz",
  "flashcard",
  "fill-blank",
  "mock-exam",
  "teach-back",
  "concept-compare",
  "slides",
  "mindmap",
  "cheatsheet",
] as const;

const templateCache = new Map<string, ToolTemplate>();

export function loadTemplate(id: string): ToolTemplate {
  if (templateCache.has(id)) return templateCache.get(id)!;
  const filePath = resolve(TEMPLATES_DIR, `${id}.json`);
  const raw = readFileSync(filePath, "utf-8");
  const template = JSON.parse(raw) as ToolTemplate;
  templateCache.set(id, template);
  return template;
}

export function listTemplates(): ToolTemplate[] {
  return KNOWN_IDS.map(loadTemplate);
}

export function renderPrompt(
  template: ToolTemplate,
  context: TemplateContext,
): string {
  for (const key of template.variables) {
    if (!(key in context)) {
      throw new Error(
        `Template "${template.id}" requires variable "${key}" but it was not provided.`,
      );
    }
  }
  return template.prompt_template.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => String(context[key] ?? ""),
  );
}

export function validateOutput<T>(
  template: ToolTemplate,
  rawJson: unknown,
): T {
  const schema = schemaRegistry[template.output_schema_id];
  if (!schema) {
    throw new Error(
      `No schema registered for output_schema_id "${template.output_schema_id}"`,
    );
  }
  return schema.parse(rawJson) as T;
}

export function buildTemplateOutput<T>(
  templateId: string,
  context: TemplateContext,
  rawJson: unknown,
): TemplateOutput<T> {
  const template = loadTemplate(templateId);
  const rawPrompt = renderPrompt(template, context);
  const data = validateOutput<T>(template, rawJson);
  return { templateId, renderer: template.renderer, data, rawPrompt };
}
