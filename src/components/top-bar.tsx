"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const TABS: Array<{ slug: string; label: string; href: string }> = [
  { slug: "library", label: "Library", href: "/library" },
  { slug: "studio", label: "Studio", href: "/create" },
  { slug: "analytics", label: "Analytics", href: "/analytics" },
  { slug: "distribution", label: "Distribution", href: "/distribution" },
  { slug: "playlists", label: "Playlists", href: "/playlists" },
  { slug: "archive", label: "Archive", href: "/archive" },
];

export function TopBar() {
  const pathname = usePathname() ?? "/";
  const [q, setQ] = useState("");

  const isActive = (href: string) => {
    if (href === "/library") return pathname === "/" || pathname.startsWith("/library");
    if (href === "/create") return pathname.startsWith("/create") || pathname.startsWith("/studio");
    return pathname === href;
  };

  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl" style={{ background: "var(--color-bg2)", borderBottom: "1px solid var(--color-brd)" }}>
      <div className="max-w-[1440px] mx-auto px-6 lg:px-10 h-14 flex items-center gap-4">
        <Link href="/" className="flex flex-col shrink-0 leading-none">
          <span className="font-display text-[1.1rem] font-extrabold tracking-tight title-grad">Music House</span>
          <span className="font-mono text-[0.5rem] uppercase tracking-[0.08em] text-t3 mt-0.5">Suno V5.5 · Mureka V8 · Distrokid</span>
        </Link>

        <nav className="flex items-center gap-0.5 ml-4">
          {TABS.map((t) => {
            const active = isActive(t.href);
            return (
              <Link
                key={t.slug}
                href={t.href}
                className={
                  "relative px-3 py-1.5 text-[0.75rem] font-display font-semibold rounded transition-colors " +
                  (active ? "text-pink" : "text-t3 hover:text-t2")
                }
                style={active ? { background: "rgba(236,72,153,0.08)" } : undefined}
              >
                {t.label}
                {active && <span className="absolute bottom-0 left-[20%] right-[20%] h-[2px] bg-pink rounded-full" />}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-t3 text-[0.75rem]">⌕</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tracks..."
            className="font-mono text-[0.68rem] pl-7 pr-2.5 h-7 rounded-md border outline-none transition-all"
            style={{
              background: "var(--color-surface)",
              borderColor: q ? "var(--color-purple)" : "var(--color-brd)",
              color: "var(--color-t1)",
              width: q ? 260 : 180,
            }}
          />
        </div>

        <a
          href="https://project-hub-olive-pi.vercel.app"
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[0.65rem] text-t3 hover:text-purple transition-colors"
        >
          Hub
        </a>
      </div>
    </header>
  );
}
