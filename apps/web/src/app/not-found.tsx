/* eslint-disable i18next/no-literal-string -- root boundary renders outside NextIntlClientProvider, bilingual fallback copy is intentional */
import Link from "next/link";

export default function RootNotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#FAFAFA",
        color: "#171717",
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
            color: "#525252",
            textTransform: "uppercase",
            marginBottom: 24,
          }}
        >
          [ 404 · NOT FOUND ]
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
          찾을 수 없는 페이지
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: "#262626", margin: "0 0 32px" }}>
          주소가 바뀌었거나 아직 없는 페이지예요.
          <br />
          <span style={{ color: "#525252", fontSize: 14 }}>Page not found.</span>
        </p>
        <Link
          href="/"
          style={{
            display: "inline-block",
            background: "#171717",
            color: "#FAFAFA",
            padding: "12px 24px",
            borderRadius: 6,
            fontSize: 15,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          홈으로 / Home
        </Link>
      </div>
    </div>
  );
}
