import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
const dev = process.env.NODE_ENV === "development";

// Static CSP (GitHub Pages cannot send headers). connect-src must allow the API origin.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' https:${dev ? " http://localhost:* ws://localhost:*" : ""}`,
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

// The public face is deliberately generic; the app only reveals itself after unlock.
export const metadata: Metadata = {
  title: "503 Service Temporarily Unavailable",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  manifest: `${base}/manifest.webmanifest`,
  icons: {
    icon: [{ url: `${base}/icons/favicon-32.png`, sizes: "32x32", type: "image/png" }],
    apple: [{ url: `${base}/icons/apple-touch-icon.png`, sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Agency Pay", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false, email: false, address: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  themeColor: "#07080b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={csp} />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
