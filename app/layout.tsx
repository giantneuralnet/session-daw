import type { Metadata, Viewport } from "next";
import "./globals.css";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#141518",
};
export const metadata: Metadata = {
  title: "Session",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Session",
    statusBarStyle: "black-translucent",
  },
  icons: { icon: "/icons/session-192.png", apple: "/icons/session-180.png" },
  description:
    "A browser-based synthesizer and synchronized session sequencer.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body data-session-shell="1">{children}</body>
    </html>
  );
}
