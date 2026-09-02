import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenCast — edit media by conversation",
  description: "An on-device, transcript-based media editor with a WebMCP co-editor.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
