/**
 * Literature search federation — queries arXiv and Semantic Scholar in
 * parallel, deduplicates by DOI, and resolves open-access PDF URLs via
 * Unpaywall. Crossref fires only when both primary sources return 0 results.
 *
 * All network calls use the global fetch (Node 18+). Rate limiting and auth
 * live at the route layer; this file is pure data transformation so it can
 * be unit-tested by stubbing globalThis.fetch.
 */

export interface PaperResult {
  id: string; // doi or "arxiv:<id>"
  doi: string | null;
  arxivId: string | null;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  source: "arxiv" | "semantic_scholar" | "crossref";
  openAccessPdfUrl: string | null;
  citationCount: number | null;
  alreadyImported: boolean; // filled in by route layer, default false here
}

const DEFAULT_CONTACT = process.env.CONTACT_EMAIL ?? "contact@example.com";

function contactEmail(envVar: "UNPAYWALL_EMAIL" | "CROSSREF_MAILTO"): string {
  return process.env[envVar] ?? DEFAULT_CONTACT;
}

// ─── arXiv ────────────────────────────────────────────────────────────────────

async function queryArxiv(query: string, limit: number): Promise<PaperResult[]> {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("max_results", String(limit));
  url.searchParams.set("sortBy", "relevance");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": `OpenCairn/1.0 (${contactEmail("UNPAYWALL_EMAIL")})`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];

  const xml = await res.text();
  return parseArxivAtom(xml);
}

function parseArxivAtom(xml: string): PaperResult[] {
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) ?? [];
  return entries.map((entry) => {
    const arxivId =
      (entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/) ?? [])[1]?.trim() ?? null;
    const title = decodeXml(
      (entry.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1]?.trim() ?? "Untitled",
    );
    const abstract = decodeXml(
      (entry.match(/<summary>([\s\S]*?)<\/summary>/) ?? [])[1]?.trim() ?? "",
    );
    const yearRaw = (entry.match(/<published>(\d{4})/) ?? [])[1];
    const year = yearRaw ? Number(yearRaw) : null;
    const authors = Array.from(entry.matchAll(/<name>([\s\S]*?)<\/name>/g)).map((m) =>
      m[1].trim(),
    );
    // arXiv DOIs surface in <arxiv:doi>; many entries omit them.
    const doi = (entry.match(/<arxiv:doi[^>]*>(.*?)<\/arxiv:doi>/) ?? [])[1]?.trim() ?? null;
    const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null;

    return {
      id: doi ?? (arxivId ? `arxiv:${arxivId}` : `arxiv-unknown:${title.slice(0, 40)}`),
      doi,
      arxivId,
      title,
      authors,
      year,
      abstract: abstract || null,
      source: "arxiv" as const,
      openAccessPdfUrl: pdfUrl,
      citationCount: null,
      alreadyImported: false,
    };
  });
}

// ─── Semantic Scholar ──────────────────────────────────────────────────────────

interface SSPaper {
  title?: string;
  authors?: { name: string }[];
  year?: number | null;
  abstract?: string | null;
  citationCount?: number | null;
  externalIds?: { DOI?: string; ArXiv?: string };
  openAccessPdf?: { url: string } | null;
}

async function querySemanticScholar(
  query: string,
  limit: number,
): Promise<PaperResult[]> {
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const headers: Record<string, string> = { "User-Agent": "OpenCairn/1.0" };
  if (apiKey) headers["x-api-key"] = apiKey;

  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set(
    "fields",
    "title,authors,year,abstract,citationCount,externalIds,openAccessPdf",
  );

  const res = await fetch(url.toString(), {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];

  const json = (await res.json()) as { data?: SSPaper[] };
  return (json.data ?? []).map(ssToResult);
}

function ssToResult(p: SSPaper): PaperResult {
  const doi = p.externalIds?.DOI ?? null;
  const arxivId = p.externalIds?.ArXiv ?? null;
  return {
    id: doi ?? (arxivId ? `arxiv:${arxivId}` : `ss:${p.title ?? Math.random()}`),
    doi,
    arxivId,
    title: p.title ?? "Untitled",
    authors: (p.authors ?? []).map((a) => a.name),
    year: p.year ?? null,
    abstract: p.abstract ?? null,
    source: "semantic_scholar" as const,
    openAccessPdfUrl: p.openAccessPdf?.url ?? null,
    citationCount: p.citationCount ?? null,
    alreadyImported: false,
  };
}

// ─── Crossref (fallback only) ──────────────────────────────────────────────────

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string }[];
  published?: { "date-parts"?: [[number, ...number[]]] };
  abstract?: string;
}

async function queryCrossref(
  query: string,
  limit: number,
): Promise<PaperResult[]> {
  const email = contactEmail("CROSSREF_MAILTO");
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query", query);
  url.searchParams.set("rows", String(limit));
  url.searchParams.set("select", "DOI,title,author,published,abstract");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": `OpenCairn/1.0 (mailto:${email})` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];

  const json = (await res.json()) as { message?: { items?: CrossrefItem[] } };
  return (json.message?.items ?? []).map(crossrefToResult);
}

function crossrefToResult(item: CrossrefItem): PaperResult {
  const doi = item.DOI ?? null;
  const year = item.published?.["date-parts"]?.[0]?.[0] ?? null;
  const authors = (item.author ?? []).map((a) =>
    [a.given, a.family].filter(Boolean).join(" "),
  );
  return {
    id: doi ?? `crossref:${item.title?.[0] ?? Math.random()}`,
    doi,
    arxivId: null,
    title: item.title?.[0] ?? "Untitled",
    authors,
    year: year ?? null,
    abstract: item.abstract ? stripHtml(item.abstract) : null,
    source: "crossref" as const,
    openAccessPdfUrl: null,
    citationCount: null,
    alreadyImported: false,
  };
}

// ─── Unpaywall ────────────────────────────────────────────────────────────────

async function resolveOaUrl(doi: string): Promise<string | null> {
  const email = contactEmail("UNPAYWALL_EMAIL");
  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      best_oa_location?: { url_for_pdf?: string } | null;
    };
    return json.best_oa_location?.url_for_pdf ?? null;
  } catch {
    return null;
  }
}

// ─── Dedupe + merge ───────────────────────────────────────────────────────────

/**
 * Merge arXiv + Semantic Scholar results. Dedupe key precedence:
 *   1. DOI (canonical, cross-source)
 *   2. arxiv:<id> (when no DOI on either side)
 *   3. source-specific id (won't collide across sources)
 *
 * When both sources produce the same paper:
 *   - Semantic Scholar wins on citationCount + longer abstract.
 *   - arXiv wins on openAccessPdfUrl (it always provides one) and arxivId.
 */
export function mergeResults(
  arxiv: PaperResult[],
  ss: PaperResult[],
): PaperResult[] {
  const dedupeKey = (p: PaperResult): string =>
    p.doi ?? (p.arxivId ? `arxiv:${p.arxivId}` : p.id);

  const merged = new Map<string, PaperResult>();
  for (const p of arxiv) merged.set(dedupeKey(p), p);

  for (const p of ss) {
    const key = dedupeKey(p);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, p);
      continue;
    }
    if (p.citationCount !== null && p.citationCount !== undefined) {
      existing.citationCount = p.citationCount;
    }
    if ((p.abstract?.length ?? 0) > (existing.abstract?.length ?? 0)) {
      existing.abstract = p.abstract;
    }
    // arXiv always has openAccessPdfUrl + arxivId — keep them.
    if (!existing.openAccessPdfUrl && p.openAccessPdfUrl) {
      existing.openAccessPdfUrl = p.openAccessPdfUrl;
    }
  }

  return Array.from(merged.values());
}

// ─── Unpaywall batch enrichment ───────────────────────────────────────────────

// Cap concurrent Unpaywall requests so a 50-result page doesn't fire 50
// simultaneous calls. Unpaywall publishes a 100k/day soft limit but is
// known to 429 on bursts; without throttling a single page load could
// blow the budget for the whole worker. 8 keeps wall-clock close to the
// per-call 5s timeout while staying well under any reasonable burst cap.
const UNPAYWALL_CONCURRENCY = 8;

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return out;
}

async function enrichWithUnpaywall(
  results: PaperResult[],
): Promise<PaperResult[]> {
  const needsCheck = results.filter((r) => !r.openAccessPdfUrl && r.doi);
  if (needsCheck.length === 0) return results;
  const resolved = await mapWithLimit(
    needsCheck,
    UNPAYWALL_CONCURRENCY,
    async (r) => ({ id: r.id, url: await resolveOaUrl(r.doi as string) }),
  );
  const byId = new Map(resolved.map((r) => [r.id, r.url]));
  return results.map((r) =>
    r.openAccessPdfUrl ? r : { ...r, openAccessPdfUrl: byId.get(r.id) ?? null },
  );
}

// ─── Public entry point ───────────────────────────────────────────────────────

export type LiteratureSource = "arxiv" | "semantic_scholar" | "crossref";

export interface FederatedSearchOptions {
  query: string;
  sources?: LiteratureSource[];
  limit?: number;
}

export interface FederatedSearchResult {
  results: PaperResult[];
  sourceMeta: { name: LiteratureSource; count: number }[];
}

export async function federatedSearch(
  opts: FederatedSearchOptions,
): Promise<FederatedSearchResult> {
  const { query, sources = ["arxiv", "semantic_scholar"], limit = 20 } = opts;

  const doArxiv = sources.includes("arxiv");
  const doSS = sources.includes("semantic_scholar");
  const doCrossref = sources.includes("crossref");

  const [arxivResults, ssResults] = await Promise.all([
    doArxiv ? queryArxiv(query, limit) : Promise.resolve([] as PaperResult[]),
    doSS ? querySemanticScholar(query, limit) : Promise.resolve([] as PaperResult[]),
  ]);

  let merged = mergeResults(arxivResults, ssResults);
  let crossrefCount = 0;

  // Crossref is a fallback to avoid empty UI when both primaries miss.
  if (merged.length === 0 && doCrossref) {
    const crossref = await queryCrossref(query, limit);
    crossrefCount = crossref.length;
    merged = crossref;
  }

  const enriched = await enrichWithUnpaywall(merged.slice(0, limit));

  const sourceMeta: { name: LiteratureSource; count: number }[] = [];
  if (doArxiv) sourceMeta.push({ name: "arxiv", count: arxivResults.length });
  if (doSS) sourceMeta.push({ name: "semantic_scholar", count: ssResults.length });
  if (doCrossref) sourceMeta.push({ name: "crossref", count: crossrefCount });

  return { results: enriched, sourceMeta };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

// `&amp;` must be decoded LAST. Decoding it first turns `&amp;lt;` into
// `&lt;` and then `<`, which is double-decoding (CodeQL js/double-escaping).
function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    // Both forms: &apos; (XML named) and &#39; (numeric). Crossref
    // metadata uses the named form for author/title apostrophes.
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// A single pass of `<[^>]+>` is incomplete on overlapping tags like `<a<b>c>`
// — first match strips `<a<b>`, leaving `c>` plus any synthesised `<` from
// the inner residue. Loop until the string stabilises so the output is
// guaranteed tag-free.
function stripHtml(s: string): string {
  let prev: string;
  let curr = s;
  do {
    prev = curr;
    curr = curr.replace(/<[^>]+>/g, "");
  } while (curr !== prev);
  return curr;
}
