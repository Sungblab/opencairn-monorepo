import DOMPurify from "isomorphic-dompurify";

// Plan 2D — DOMPurify wrapper used by the chat renderer before
// react-markdown processes the body. We keep a small whitelist of GFM
// tags + SVG (no <script>, <iframe>, <object>, <embed>, no inline
// event handlers, no javascript: hrefs).
//
// Why not let react-markdown do this on its own? `react-markdown`
// doesn't render raw HTML by default, but `rehype-raw` (which we need
// for inline SVG and HTML embedded in agent responses) does. So we
// sanitize the input string before it ever reaches the markdown
// pipeline — defense in depth on top of `rehype-raw`'s own filter.

const ALLOWED_TAGS = [
  // GFM
  "p", "br", "strong", "em", "u", "s", "del", "code", "pre",
  "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "hr", "a",
  "table", "thead", "tbody", "tr", "th", "td",
  // Inline math (KaTeX wraps in span)
  "span", "div",
  // SVG
  "svg", "g", "path", "rect", "circle", "ellipse", "line",
  "polyline", "polygon", "text", "tspan", "title", "desc",
  "defs", "linearGradient", "radialGradient", "stop", "use",
  "symbol", "marker", "clipPath", "mask", "pattern",
  "foreignObject",
];

const ALLOWED_ATTRS = [
  // Common
  "class", "id", "role", "aria-label", "aria-hidden",
  "data-language", "data-katex",
  // Anchor
  "href", "target", "rel",
  // SVG
  "viewBox", "width", "height", "x", "y", "x1", "x2", "y1", "y2",
  "cx", "cy", "r", "rx", "ry", "d", "points",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "transform", "opacity", "fill-opacity", "stroke-opacity",
  "text-anchor", "dominant-baseline",
  "preserveAspectRatio", "xmlns", "xmlns:xlink",
];

export function sanitizeHtml(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRS,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|#|\/):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    USE_PROFILES: { svg: true, html: true },
  });
}
