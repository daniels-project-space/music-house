import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/convex-provider";
import { Player } from "@/components/player";
import { PlayerProvider } from "@/components/player-context";
import { TopBar } from "@/components/top-bar";
import { PipelineStrip } from "@/components/pipeline-strip";
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
      <body className="min-h-screen flex flex-col">
        <ConvexClientProvider>
          <UrlCacheProvider>
            <PlayerProvider>
              <GlobalUrlPrefetch />
              <DragAutoScroll />
              <div className="sticky top-0 z-30">
                <TopBar />
                <PipelineStrip />
              </div>
              <div className="flex-1">{children}</div>
              <Player />
            </PlayerProvider>
          </UrlCacheProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
