import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/convex-provider";
import { Player } from "@/components/player";
import { PlayerProvider } from "@/components/player-context";
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
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Outfit:wght@300;400;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="pb-24">
        <ConvexClientProvider>
          <PlayerProvider>
            <Nav />
            {children}
            <Player />
          </PlayerProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}

function Nav() {
  return (
    <nav className="sticky top-0 z-40 border-b border-rule-soft/60 backdrop-blur bg-ink/80">
      <div className="max-w-[1440px] mx-auto px-8 lg:px-14 py-4 flex items-center justify-between">
        <a href="/" className="font-display text-xl font-semibold text-paper">
          Music <span className="italic text-paper-dim">House</span>
        </a>
        <div className="flex items-center gap-6 text-sm font-mono uppercase tracking-wider text-paper-dim">
          <a href="/library" className="hover:text-paper">Library</a>
          <a href="/playlists" className="hover:text-paper">Playlists</a>
          <a href="/jobs" className="hover:text-paper">Jobs</a>
          <a href="/create" className="px-3 py-1 rounded border border-amber/40 text-amber hover:bg-amber/10">+ Create</a>
        </div>
      </div>
    </nav>
  );
}
