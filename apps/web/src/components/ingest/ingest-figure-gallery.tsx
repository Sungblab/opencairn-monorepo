"use client";
import type { FigureItem } from "@/stores/ingest-store";

export function IngestFigureGallery({
  figures,
  workflowId,
}: {
  figures: FigureItem[];
  workflowId: string;
}) {
  if (figures.length === 0) return null;
  return (
    <ul className="ingest-figures-list">
      {figures.map((f, i) => {
        const filename = f.objectKey.split("/").pop() ?? "";
        return (
          <li
            key={`${f.objectKey}-${i}`}
            className={`figure-item kind-${f.figureKind}`}
          >
            <img
              src={`/api/ingest/figures/${workflowId}/${encodeURIComponent(filename)}`}
              alt={f.caption ?? ""}
              loading="lazy"
            />
            {f.caption && <figcaption>{f.caption}</figcaption>}
          </li>
        );
      })}
    </ul>
  );
}
