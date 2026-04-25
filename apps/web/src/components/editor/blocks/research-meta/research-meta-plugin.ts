import { createPlatePlugin } from "platejs/react";
import { RESEARCH_META_KEY } from "./research-meta-types";
import { ResearchMetaElement } from "./ResearchMetaElement";

// Void block — content is read-only metadata. Worker is the only producer
// (persist_report_activity inserts this as the first node of the report
// note). Intentionally NOT registered with the slash menu: users cannot
// insert it manually.
//
// `withComponent` is the v49-correct way to attach a renderer (see
// docs/contributing/llm-antipatterns.md §8). Do NOT use `kit({ components })`
// or `editor.tf.toggleBlock` — those APIs do not exist in v49.
export const researchMetaPlugin = createPlatePlugin({
  key: RESEARCH_META_KEY,
  node: {
    type: RESEARCH_META_KEY,
    isElement: true,
    isVoid: true,
  },
}).withComponent(ResearchMetaElement);
