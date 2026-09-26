import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Session",
  description:
    "A browser-based synthesizer and synchronized session sequencer.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
