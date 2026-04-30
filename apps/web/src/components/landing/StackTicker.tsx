const TOKENS = [
  "PDF", "DOCX", "PPTX", "EPUB", "HWP", "MP3", "MP4", "URL", "NOTION EXPORT",
  "GITHUB", "PLAIN TEXT", "IMAGES", "OCR", "WHISPER", "PYODIDE", "CYTOSCAPE",
  "LIGHTRAG", "GEMINI", "OLLAMA", "LANGGRAPH", "TEMPORAL", "HOCUSPOCUS",
  "YJS CRDT", "PGVECTOR", "PLATE", "BETTER AUTH", "RESEND", "SENTRY", "DOCKER",
  "AGPLV3 + COMMERCIAL",
];

function Track() {
  return (
    <span>
      {"› "}
      {TOKENS.map((tok, i) => (
        <span key={i}>
          {tok}
          <span className="sep">·</span>
        </span>
      ))}
    </span>
  );
}

export function StackTicker() {
  return (
    <div className="ticker-viewport" aria-hidden>
      <div className="ticker-track">
        <Track />
        <Track />
      </div>
    </div>
  );
}
