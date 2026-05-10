/* eslint-disable i18next/no-literal-string -- root boundary renders outside NextIntlClientProvider, bilingual fallback copy is intentional */

// Inline + <style> because this boundary renders outside the i18n + Tailwind
// runtime; we ship self-contained styles so 404 still feels on-brand.

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
        .nf-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: #171717;
        }
        .nf-eyebrow-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #171717;
          animation: nf-pulse 2.4s ease-in-out infinite;
        }
        @keyframes nf-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
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
              <div className="nf-eyebrow">
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

            <a href="/" className="nf-btn">
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
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
