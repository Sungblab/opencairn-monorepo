/* eslint-disable i18next/no-literal-string -- root boundary renders outside NextIntlClientProvider, bilingual fallback copy is intentional */
import Link from "next/link";

// Inline + <style> because this boundary renders outside the i18n + Tailwind
// runtime; we ship self-contained styles so 404 still feels on-brand.

const STONES = [
  { w: 176, h: 22, rot: 0 },
  { w: 140, h: 20, rot: -3 },
  { w: 108, h: 17, rot: 4 },
  { w: 80, h: 15, rot: -5 },
  { w: 58, h: 13, rot: 7 },
] as const;

export default function RootNotFound() {
  return (
    <>
      <style>{`
        .nf-root {
          min-height: 100vh;
          background: #F5F5F5;
          color: #171717;
          font-family: Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          display: flex;
          flex-direction: column;
        }
        @media (min-width: 1024px) { .nf-root { flex-direction: row; } }
        .nf-left {
          flex: 1;
          background: #171717;
          color: #FAFAFA;
          padding: 40px;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        @media (min-width: 1024px) { .nf-left { padding: 64px; } }
        .nf-right {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 48px 24px;
        }
        .nf-card {
          width: 100%;
          max-width: 448px;
          background: #FFFFFF;
          border: 2px solid #171717;
          border-radius: 12px;
          padding: 32px;
          box-shadow: 0 4px 0 0 #171717;
        }
        @media (min-width: 640px) { .nf-card { padding: 40px; } }
        .nf-logo {
          align-self: flex-start;
          font-family: "Instrument Serif", Georgia, serif;
          font-size: 24px;
          line-height: 1;
          color: #FAFAFA;
          text-decoration: none;
          padding: 4px 12px;
          border-radius: 6px;
          transition: background 0.15s, color 0.15s;
          position: relative;
          z-index: 1;
        }
        .nf-logo:hover { background: #FAFAFA; color: #171717; }
        .nf-center {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 32px;
          margin-top: 40px;
          position: relative;
          z-index: 1;
        }
        @media (min-width: 1024px) { .nf-center { margin-top: 0; } }
        .nf-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.22em;
          text-transform: uppercase;
        }
        .nf-eyebrow-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #A3A3A3;
          animation: nf-pulse 2.4s ease-in-out infinite;
        }
        @keyframes nf-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .nf-big {
          font-family: Pretendard, -apple-system, system-ui, sans-serif;
          font-size: 140px;
          font-weight: 900;
          line-height: 0.85;
          letter-spacing: -0.04em;
          color: #FAFAFA;
          margin: 0;
          user-select: none;
        }
        @media (min-width: 640px) { .nf-big { font-size: 180px; } }
        @media (min-width: 1280px) { .nf-big { font-size: 220px; } }
        .nf-stones {
          display: flex;
          flex-direction: column-reverse;
          align-items: flex-start;
          gap: 4px;
          max-width: 220px;
        }
        .nf-stone {
          display: block;
          border-radius: 9999px;
          background: #404040;
          border: 1px solid #525252;
        }
        .nf-grid {
          position: absolute;
          inset: 0;
          opacity: 0.04;
          pointer-events: none;
          background-image: linear-gradient(to right, #fff 1px, transparent 1px);
          background-size: calc(100% / 12) 100%;
        }
        .nf-card-eyebrow { color: #171717; }
        .nf-card-eyebrow .nf-eyebrow-dot { background: #171717; }
        .nf-title {
          font-family: Pretendard, -apple-system, system-ui, sans-serif;
          font-size: 30px;
          font-weight: 700;
          line-height: 1.15;
          color: #171717;
          margin: 0;
          word-break: keep-all;
        }
        @media (min-width: 640px) { .nf-title { font-size: 36px; } }
        .nf-body {
          font-size: 15px;
          line-height: 1.6;
          color: #525252;
          margin: 0;
          word-break: keep-all;
        }
        .nf-body .mono {
          display: block;
          margin-top: 6px;
          color: #737373;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px;
          letter-spacing: 0.04em;
        }
        .nf-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          height: 44px;
          background: #171717;
          color: #FAFAFA;
          border: 2px solid #171717;
          border-radius: 6px;
          padding: 0 16px;
          font-size: 14px;
          font-weight: 600;
          text-decoration: none;
          box-shadow: 0 3px 0 0 #171717;
          transition: background 0.12s, color 0.12s, transform 0.08s, box-shadow 0.08s;
          cursor: pointer;
        }
        .nf-btn:hover {
          background: #FFFFFF;
          color: #171717;
          box-shadow: 0 4px 0 0 #171717;
        }
        .nf-btn:active {
          transform: translateY(3px);
          box-shadow: 0 0 0 0 #171717;
        }
      `}</style>

      <div className="nf-root">
        {/* LEFT — editorial 404 display */}
        <div className="nf-left">
          <Link href="/" className="nf-logo">
            OpenCairn
          </Link>

          <div className="nf-center">
            <div className="nf-eyebrow">
              <span className="nf-eyebrow-dot" aria-hidden />
              <span>[ 404 · NOT FOUND ]</span>
            </div>

            <p className="nf-big" aria-hidden>
              404
            </p>

            {/* tilted cairn — unstacked stones, wayfinding marker lost */}
            <div className="nf-stones" aria-hidden>
              {STONES.map((s, i) => (
                <span
                  key={i}
                  className="nf-stone"
                  style={{
                    width: s.w,
                    height: s.h,
                    transform: `rotate(${s.rot}deg) translateX(${s.rot * 2}px)`,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="nf-grid" aria-hidden />
        </div>

        {/* RIGHT — card with CTA */}
        <div className="nf-right">
          <div className="nf-card">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 24,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div className="nf-eyebrow nf-card-eyebrow">
                  <span className="nf-eyebrow-dot" aria-hidden />
                  <span>[ 404 · NOT FOUND ]</span>
                </div>
                <h1 className="nf-title">찾을 수 없는 페이지</h1>
                <p className="nf-body">
                  주소가 바뀌었거나 아직 없는 페이지예요.
                  <br />
                  쌓이지 않은 돌, 아직 그려지지 않은 길.
                  <span className="mono">Page not found.</span>
                </p>
              </div>

              <Link href="/" className="nf-btn">
                <span>홈으로 / Home</span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
