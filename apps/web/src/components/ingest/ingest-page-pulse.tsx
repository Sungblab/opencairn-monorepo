"use client";

export function IngestPagePulse({
  units,
}: {
  units: { current: number; total: number | null };
}) {
  return (
    <div className="ingest-pulse-card" data-testid="ingest-pulse">
      <div className="page-shadow" />
      <div className="scan-ray" data-current={units.current} />
      {units.total !== null && (
        <span className="ingest-pulse-progress">
          {units.current} / {units.total}
        </span>
      )}
    </div>
  );
}
