import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#1C1917",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="140" height="140" viewBox="0 0 32 32">
          <rect x="6" y="22" width="20" height="5" rx="1.2" fill="#F5F3EE" />
          <rect x="9" y="14" width="14" height="5" rx="1.2" fill="#F5F3EE" />
          <rect x="12" y="6" width="8" height="5" rx="1.2" fill="#F5F3EE" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
