import type { Metadata } from "next";
import "./globals.css";
import { ClarifyProvider } from "@/src/context/ClarifyContext";

export const metadata: Metadata = {
  title: "ClariFy",
  description: "Official Academic Communication Hub & Broadcast Portal",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: ["/icon.svg"],
    apple: ["/icon.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="icon"
          href="/icon.svg"
          type="image/svg+xml"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <style>{`
          :root {
            --font-plus-jakarta: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          body {
            font-family: var(--font-plus-jakarta);
          }
        `}</style>
      </head>
      <body className="antialiased min-h-screen bg-slate-950 text-slate-100">
        <ClarifyProvider>
          {children}
        </ClarifyProvider>
      </body>
    </html>
  );
}