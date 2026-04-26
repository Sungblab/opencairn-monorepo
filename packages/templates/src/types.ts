import type { ZodTypeAny } from "zod";

export type RendererType = "structured" | "canvas";

export type ToolTemplate = {
  id: string;
  name: string;
  description: string;
  renderer: RendererType;
  prompt_template: string;
  variables: string[];
  output_schema_id: string;
};

export type TemplateContext = Record<string, string | number | boolean>;

export type TemplateOutput<T = unknown> = {
  templateId: string;
  renderer: RendererType;
  data: T;
  rawPrompt: string;
};
