import type { Metadata } from "next";
import localFont from "next/font/local";
import { PlayViewport } from "../../play/PlayViewport";
import "./tailwind.css";

const bodyFont = localFont({
  src: "../../../public/play/manrope-variable.ttf",
  weight: "200 800",
  variable: "--font-body",
  display: "swap",
});
const displayFont = localFont({
  src: "../../../public/play/space-grotesk-variable.ttf",
  weight: "300 700",
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Consultation · Mr.Fund",
  description: "A conversation with your DeFi companion. A simulated Mr.Fund consultation.",
  robots: { index: false, follow: false },
};

export default function PlayPage() {
  return (
    <div className={`${bodyFont.variable} ${displayFont.variable}`}>
      <PlayViewport source="demo" />
    </div>
  );
}
