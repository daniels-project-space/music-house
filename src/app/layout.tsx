import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/convex-provider";
import { Player } from "@/components/player";
import { PlayerProvider } from "@/components/player-context";
import { Sidebar } from "@/components/sidebar";
import { UrlCacheProvider } from "@/components/url-cache-provider";
import { GlobalUrlPrefetch } from "@/components/global-url-prefetch";
import { DragAutoScroll } from "@/components/drag-autoscroll";
import "./globals.css";

export const metadata: Metadata = {
  title: "Music House",
  description: "AI music label — Suno V5.5 · Mureka V8 · Distrokid",
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
              <div className="flex min-h-screen">
                <Sidebar />
                <div className="flex-1 min-w-0 flex flex-col">
                  {children}
                </div>
              </div>
              <Player />
            </PlayerProvider>
          </UrlCacheProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
