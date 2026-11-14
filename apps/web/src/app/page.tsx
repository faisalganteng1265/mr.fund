import type { Metadata } from "next";
import localFont from "next/font/local";
import { Landing } from "../landing/Landing";
import "./landing.css";
import "lenis/dist/lenis.css";

const bodyFont = localFont({
  src: "../../public/play/manrope-variable.ttf",
  weight: "200 800",
  variable: "--font-body",
  display: "swap",
});
const displayFont = localFont({
  src: "../../public/play/space-grotesk-variable.ttf",
  weight: "300 700",
  variable: "--font-display",
  display: "swap",
});

const editorialFont = localFont({
  src: "../../public/landing/instrument-serif-italic.ttf",
  weight: "400",
  style: "italic",
  variable: "--font-editorial",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mr.Fund · The DeFi manager you can talk to",
  description:
    "Mr.Fund explains your NEAR lending position in plain words, shows the smartest move, and acts only within limits you set.",
};

export default function Home() {
  return (
    <div className={`${bodyFont.variable} ${displayFont.variable} ${editorialFont.variable}`}>
      <Landing />
    </div>
  );
}
