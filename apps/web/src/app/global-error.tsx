"use client";
/* eslint-disable i18next/no-literal-string -- root error boundary renders outside NextIntlClientProvider */
import { useEffect } from "react";

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
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#F5F3EE",
          color: "#1C1917",
          fontFamily:
            'Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 560 }}>
          <div
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 11,
              letterSpacing: "0.18em",
              color: "#6B6559",
              textTransform: "uppercase",
              marginBottom: 24,
            }}
          >
            [ FATAL · SYSTEM ERROR ]
          </div>
          <h1
            style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontSize: 56,
              fontWeight: 400,
              lineHeight: 1.05,
              margin: "0 0 20px",
            }}
          >
            시스템 오류
          </h1>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.6,
              color: "#403C32",
              margin: "0 0 32px",
            }}
          >
            복구할 수 없는 오류가 발생했습니다. 페이지를 새로고침 해주세요.
            <br />
            <span style={{ color: "#6B6559", fontSize: 14 }}>
              An unrecoverable error occurred. Please reload the page.
            </span>
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#1C1917",
              color: "#F5F3EE",
              border: 0,
              padding: "12px 24px",
              borderRadius: 6,
              fontSize: 15,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            새로고침 / Reload
          </button>
          {error.digest && (
            <p
              style={{
                marginTop: 28,
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
                letterSpacing: "0.12em",
                color: "#9A9285",
                textTransform: "uppercase",
              }}
            >
              Error ID: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
