"use client";
/* eslint-disable i18next/no-literal-string -- root error boundary renders outside NextIntlClientProvider */
import { useEffect } from "react";

// Global error boundary renders outside Tailwind/i18n providers. Self-contained
// styles via <style> so the fatal page still feels on-brand.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ko">
      <body style={{ margin: 0 }}>
        <style>{`
          .ge-root {
            min-height: 100vh;
            background: #F5F5F5;
            color: #171717;
            font-family: Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
            display: flex;
            flex-direction: column;
          }
          @media (min-width: 1024px) { .ge-root { flex-direction: row; } }
          .ge-left {
            flex: 1;
            background: #171717;
            color: #FAFAFA;
            padding: 40px;
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }
          @media (min-width: 1024px) { .ge-left { padding: 64px; } }
          .ge-right {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 48px 24px;
          }
          .ge-card {
            width: 100%;
            max-width: 448px;
            background: #FFFFFF;
            border: 2px solid #171717;
            border-radius: 12px;
            padding: 32px;
            box-shadow: 0 4px 0 0 #171717;
          }
          @media (min-width: 640px) { .ge-card { padding: 40px; } }
          .ge-logo {
            align-self: flex-start;
            font-family: "Instrument Serif", Georgia, serif;
            font-size: 24px;
            line-height: 1;
            color: #FAFAFA;
            padding: 4px 12px;
            border-radius: 6px;
            position: relative;
            z-index: 1;
          }
          .ge-center {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 32px;
            margin-top: 40px;
            position: relative;
            z-index: 1;
          }
          @media (min-width: 1024px) { .ge-center { margin-top: 0; } }
          .ge-eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.22em;
            text-transform: uppercase;
          }
          .ge-eyebrow-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #A3A3A3;
            animation: ge-pulse 2.4s ease-in-out infinite;
          }
          @keyframes ge-pulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 1; }
          }
          .ge-big {
            font-family: Pretendard, -apple-system, system-ui, sans-serif;
            font-size: 120px;
            font-weight: 900;
            line-height: 0.85;
            letter-spacing: -0.04em;
            color: #FAFAFA;
            margin: 0;
            user-select: none;
          }
          @media (min-width: 640px) { .ge-big { font-size: 160px; } }
          @media (min-width: 1280px) { .ge-big { font-size: 200px; } }
          .ge-stones { position: relative; height: 110px; max-width: 320px; }
          .ge-stone {
            display: block;
            position: absolute;
            border-radius: 9999px;
            background: #404040;
            border: 1px solid #525252;
          }
          .ge-grid {
            position: absolute;
            inset: 0;
            opacity: 0.04;
            pointer-events: none;
            background-image: linear-gradient(to right, #fff 1px, transparent 1px);
            background-size: calc(100% / 12) 100%;
          }
          .ge-card-eyebrow { color: #171717; }
          .ge-card-eyebrow .ge-eyebrow-dot { background: #171717; }
          .ge-title {
            font-family: Pretendard, -apple-system, system-ui, sans-serif;
            font-size: 30px;
            font-weight: 700;
            line-height: 1.15;
            color: #171717;
            margin: 0;
            word-break: keep-all;
          }
          @media (min-width: 640px) { .ge-title { font-size: 36px; } }
          .ge-body {
            font-size: 15px;
            line-height: 1.6;
            color: #525252;
            margin: 0;
            word-break: keep-all;
          }
          .ge-body .mono {
            display: block;
            margin-top: 6px;
            color: #737373;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 12px;
            letter-spacing: 0.04em;
          }
          .ge-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            width: 100%;
            height: 44px;
            border: 2px solid #171717;
            border-radius: 6px;
            padding: 0 16px;
            font-size: 14px;
            font-weight: 600;
            text-decoration: none;
            box-shadow: 0 3px 0 0 #171717;
            transition: background 0.12s, color 0.12s, transform 0.08s, box-shadow 0.08s;
            cursor: pointer;
            font-family: inherit;
          }
          .ge-btn-primary { background: #171717; color: #FAFAFA; }
          .ge-btn-primary:hover { background: #FFFFFF; color: #171717; box-shadow: 0 4px 0 0 #171717; }
          .ge-btn-primary:active { transform: translateY(3px); box-shadow: 0 0 0 0 #171717; }
          .ge-btn-secondary { background: #FFFFFF; color: #171717; }
          .ge-btn-secondary:hover { background: #171717; color: #FAFAFA; box-shadow: 0 4px 0 0 #171717; }
          .ge-btn-secondary:active { transform: translateY(3px); box-shadow: 0 0 0 0 #171717; }
          .ge-digest {
            margin-top: 8px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 11px;
            letter-spacing: 0.12em;
            color: #A3A3A3;
            text-transform: uppercase;
            word-break: break-all;
          }
        `}</style>

        <div className="ge-root">
          {/* LEFT — fatal display */}
          <div className="ge-left">
            <span className="ge-logo">OpenCairn</span>

            <div className="ge-center">
              <div className="ge-eyebrow">
                <span className="ge-eyebrow-dot" aria-hidden />
                <span>[ FATAL · SYSTEM ERROR ]</span>
              </div>

              <p className="ge-big" aria-hidden>
                ERR
              </p>

              {/* scattered stones — the cairn has fallen */}
              <div className="ge-stones" aria-hidden>
                {[
                  { w: 176, h: 20, x: 0, y: 0, rot: -8 },
                  { w: 110, h: 16, x: 60, y: 40, rot: 18 },
                  { w: 80, h: 14, x: 180, y: 20, rot: 62 },
                  { w: 56, h: 12, x: 240, y: 70, rot: -40 },
                  { w: 38, h: 10, x: 150, y: 80, rot: 25 },
                ].map((s, i) => (
                  <span
                    key={i}
                    className="ge-stone"
                    style={{
                      width: s.w,
                      height: s.h,
                      left: s.x,
                      top: s.y,
                      transform: `rotate(${s.rot}deg)`,
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="ge-grid" aria-hidden />
          </div>

          {/* RIGHT — card with CTAs */}
          <div className="ge-right">
            <div className="ge-card">
              <div
                style={{ display: "flex", flexDirection: "column", gap: 24 }}
              >
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <div className="ge-eyebrow ge-card-eyebrow">
                    <span className="ge-eyebrow-dot" aria-hidden />
                    <span>[ FATAL · SYSTEM ERROR ]</span>
                  </div>
                  <h1 className="ge-title">시스템 오류</h1>
                  <p className="ge-body">
                    복구할 수 없는 오류가 발생했어요.
                    <br />
                    잠시 뒤 다시 시도하시거나 새로고침 해주세요.
                    <span className="mono">An unrecoverable error occurred.</span>
                  </p>
                </div>

                <div
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <button
                    type="button"
                    onClick={reset}
                    className="ge-btn ge-btn-primary"
                  >
                    새로고침 / Reload
                  </button>
                  <a href="/" className="ge-btn ge-btn-secondary">
                    홈으로 / Home
                  </a>
                </div>

                {error.digest && (
                  <p className="ge-digest">Error ID · {error.digest}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
