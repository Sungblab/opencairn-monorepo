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
          .ge-eyebrow {
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
          .ge-eyebrow-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #171717;
            animation: ge-pulse 2.4s ease-in-out infinite;
          }
          @keyframes ge-pulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 1; }
          }
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
          <div className="ge-card">
            <div
              style={{ display: "flex", flexDirection: "column", gap: 24 }}
            >
              <div
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <div className="ge-eyebrow">
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
      </body>
    </html>
  );
}
