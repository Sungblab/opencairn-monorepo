import { Instrument_Serif } from "next/font/google";

// Used ONLY for the OpenCairn wordmark in headers/footers/auth chrome.
// All headlines, prices, and body text use Pretendard via --font-sans.
export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif-raw",
  display: "swap",
  preload: false,
});
