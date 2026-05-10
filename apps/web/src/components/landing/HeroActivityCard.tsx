import type { CSSProperties } from "react";

export type ActivityItem = { agent: string; text: string };

const SHOW = 4;

const introStyle = (delayMs: number): CSSProperties =>
  ({ "--reveal-delay": `${delayMs}ms` }) as CSSProperties;

export function HeroActivityCard({
  title,
  meta,
  footer,
  items,
  timeLabels,
  introDelayMs,
}: {
  title: string;
  meta: string;
  footer: string;
  items: ActivityItem[];
  timeLabels: string[];
  introDelayMs: number;
}) {
  const shown = items.slice(0, SHOW);

  return (
    <aside
      className="md:col-span-5 reveal-intro"
      style={introStyle(introDelayMs)}
    >
      <div className="activity-card" aria-live="polite">
        <div className="ac-header">
          <span className="ac-dot" aria-hidden />
          <span className="ac-title">{title}</span>
          <span className="ac-meta">{meta}</span>
        </div>
        <ul className="ac-list">
          {shown.map((it, i) => (
            <li
              key={`${it.agent}-${i}`}
              className="ac-item in"
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              <span className="ac-agent">{it.agent}</span>
              <span className="ac-text" dangerouslySetInnerHTML={{ __html: it.text }} />
              <span className="ac-time">{timeLabels[i] ?? ""}</span>
            </li>
          ))}
        </ul>
        <div className="ac-footer">
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <path d="M2 8l4 4 8-8" />
          </svg>
          <span className="kr">{footer}</span>
        </div>
      </div>
    </aside>
  );
}
