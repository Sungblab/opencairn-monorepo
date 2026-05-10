import type { CSSProperties } from "react";

const ACTIVE_ORDER = [0, 2, 1, 7, 3, 4, 5, 9, 10, 11, 6, 8];

const AGENT_ROWS: Array<{ idx: number; x: number; y: number; text: number; fill: string; label: string }> = [
  { idx: 0, x: 20, y: 26, text: 30, fill: "#FAFAFA", label: "Compiler" },
  { idx: 1, x: 20, y: 48, text: 52, fill: "#FAFAFA", label: "Research" },
  { idx: 2, x: 20, y: 70, text: 74, fill: "#FAFAFA", label: "Librarian" },
  { idx: 3, x: 20, y: 92, text: 96, fill: "#FAFAFA", label: "Synthesis" },
  { idx: 4, x: 20, y: 114, text: 118, fill: "#FAFAFA", label: "Socratic" },
  { idx: 5, x: 20, y: 136, text: 140, fill: "#FAFAFA", label: "Narrator" },
  { idx: 6, x: 104, y: 26, text: 30, fill: "#A3A3A3", label: "Curator" },
  { idx: 7, x: 104, y: 48, text: 52, fill: "#A3A3A3", label: "Connector" },
  { idx: 8, x: 104, y: 70, text: 74, fill: "#A3A3A3", label: "Temporal" },
  { idx: 9, x: 104, y: 92, text: 96, fill: "#A3A3A3", label: "Deep R." },
  { idx: 10, x: 104, y: 114, text: 118, fill: "#A3A3A3", label: "Code" },
  { idx: 11, x: 104, y: 136, text: 140, fill: "#A3A3A3", label: "Visual." },
];

export type HeroLivePanelCopy = {
  title: string;
  compiling: string;
  input: string;
  agentsHeader: string;
  orchestration: string;
  status: string;
  output: string;
  outWikiTitle: string;
  outWikiDesc: string;
  outWikiMeta: string;
  outWikiLinksMeta: string;
  outLearnTitle: string;
  outLearnDesc: string;
  outLearnMeta: string;
  outGenTitle: string;
  outGenDesc: string;
  outGenMeta: string;
};

const introStyle = (delayMs: number): CSSProperties =>
  ({ "--reveal-delay": `${delayMs}ms` }) as CSSProperties;

export function HeroLivePanel({
  copy,
  inputItems,
  rotating,
  introDelayMs,
}: {
  copy: HeroLivePanelCopy;
  inputItems: string[];
  rotating: string[];
  introDelayMs: number;
}) {
  const activeAgent = ACTIVE_ORDER[0];
  const liveMsg = rotating[0] ?? "";
  const wikiN = 17;
  const linksN = 42;
  const cardsN = 23;

  return (
    <div
      className="mt-12 relative live-panel reveal-intro"
      style={introStyle(introDelayMs)}
    >
      <div className="bar">
        <span className="dot r" />
        <span className="dot y" />
        <span className="dot g" />
        <span className="title">{copy.title}</span>
        <span style={{ marginLeft: "auto", color: "#28C840" }}>{copy.compiling}</span>
      </div>
      <div className="px-6 py-8 md:px-10 md:py-10 relative" style={{ zIndex: 2 }}>
        <svg viewBox="0 0 900 360" className="w-full h-auto" fill="none">
          <g transform="translate(20, 40)">
            <text x={0} y={0} className="font-sans" fontSize={11} fill="#525252">
              {copy.input}
            </text>
            {inputItems.map((label, i) => (
              <g key={i}>
                <rect x={0} y={20 + i * 56} width={140} height={44} rx={4} fill="white" stroke="#A3A3A3" />
                <text x={16} y={48 + i * 56} fontSize={13} fill="#171717">
                  {label}
                </text>
              </g>
            ))}
          </g>
          <g stroke="#171717" strokeWidth={1.5}>
            <path className="flow-line" d="M 160 62 Q 260 62 340 100" />
            <path className="flow-line" d="M 160 118 Q 260 118 340 140" />
            <path className="flow-line" d="M 160 174 Q 260 174 340 180" />
            <path className="flow-line" d="M 160 230 Q 260 230 340 220" />
            <path className="flow-line" d="M 160 286 Q 260 286 340 260" />
          </g>
          <g transform="translate(340, 60)">
            <text x={50} y={-20} className="font-sans" fontSize={11} fill="#525252">
              {copy.agentsHeader}
            </text>
            <rect x={0} y={0} width={180} height={240} rx={8} fill="#2A2823" />
            <g className="font-sans" fontSize={11}>
              {AGENT_ROWS.map((r) => {
                const isActive = r.idx === activeAgent;
                return (
                  <g key={r.idx}>
                    <circle
                      cx={r.x}
                      cy={r.y}
                      r={3}
                      fill={r.fill}
                      className={isActive ? "hero-agent-active" : undefined}
                    />
                    <text x={r.x + 10} y={r.text} fill={r.fill}>
                      {r.label}
                    </text>
                  </g>
                );
              })}
            </g>
            <rect x={16} y={170} width={148} height={50} rx={4} fill="#262626" stroke="#525252" strokeWidth={0.5} />
            <text x={28} y={190} className="font-sans" fontSize={10} fill="#737373">
              {copy.orchestration}
            </text>
            <text x={28} y={208} className="font-sans" fontSize={10} fill="#FAFAFA">
              {copy.status}
            </text>
          </g>
          <g stroke="#171717" strokeWidth={1.5}>
            <path className="flow-line" d="M 520 100 Q 620 100 700 80" />
            <path className="flow-line" d="M 520 180 Q 620 180 700 180" />
            <path className="flow-line" d="M 520 260 Q 620 260 700 280" />
          </g>
          <g transform="translate(700, 40)">
            <text x={0} y={0} className="font-sans" fontSize={11} fill="#525252">
              {copy.output}
            </text>
            <rect x={0} y={20} width={180} height={72} rx={4} fill="#F5F5F5" stroke="#E5E5E5" />
            <text x={16} y={42} fontSize={12} fontWeight={600} fill="#171717">
              {copy.outWikiTitle}
            </text>
            <text x={16} y={60} fontSize={11} fill="#171717">
              {copy.outWikiDesc}
            </text>
            <text x={16} y={78} className="font-sans" fontSize={10} fill="#525252">
              <tspan>{wikiN}</tspan> {copy.outWikiMeta} · <tspan>{linksN}</tspan> {copy.outWikiLinksMeta}
            </text>

            <rect x={0} y={104} width={180} height={72} rx={4} fill="#F5F5F5" stroke="#E5E5E5" />
            <text x={16} y={126} fontSize={12} fontWeight={600} fill="#171717">
              {copy.outLearnTitle}
            </text>
            <text x={16} y={144} fontSize={11} fill="#171717">
              {copy.outLearnDesc}
            </text>
            <text x={16} y={162} className="font-sans" fontSize={10} fill="#525252">
              <tspan>{cardsN}</tspan> {copy.outLearnMeta}
            </text>

            <rect x={0} y={188} width={180} height={72} rx={4} fill="#F5F5F5" stroke="#E5E5E5" />
            <text x={16} y={210} fontSize={12} fontWeight={600} fill="#171717">
              {copy.outGenTitle}
            </text>
            <text x={16} y={228} fontSize={11} fill="#171717">
              {copy.outGenDesc}
            </text>
            <text x={16} y={246} className="font-sans" fontSize={10} fill="#525252">
              {copy.outGenMeta}
            </text>
          </g>
        </svg>
      </div>
      <div className="live-status">
        <span className="beat" aria-hidden />
        <span className="msg kr" style={{ fontFamily: "var(--font-sans)" }}>
          {liveMsg}
        </span>
      </div>
    </div>
  );
}
