import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/convex-provider";
import { PlayerProvider } from "@/components/player-context";
import { UrlCacheProvider } from "@/components/url-cache-provider";
import { GlobalUrlPrefetch } from "@/components/global-url-prefetch";
import { DragAutoScroll } from "@/components/drag-autoscroll";
import { Player } from "@/components/player";
import "./globals.css";

export const metadata: Metadata = {
  title: "Music House",
  description: "AI music label",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <ConvexClientProvider>
          <UrlCacheProvider>
            <PlayerProvider>
              <GlobalUrlPrefetch />
              <DragAutoScroll />
              {children}
              <Player />
            </PlayerProvider>
          </UrlCacheProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
