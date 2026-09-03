import type { Metadata } from "next";
import { Bricolage_Grotesque, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display" });
const body = Fraunces({ subsets: ["latin"], variable: "--font-body", axes: ["opsz"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "OpenCast — edit media by conversation",
  description: "A transcript-based media editor with a WebMCP co-editor.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
