"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const TABS: Array<{ slug: string; label: string; href: string }> = [
  { slug: "library", label: "Library", href: "/library" },
  { slug: "studio", label: "Studio", href: "/studio" },
  { slug: "analytics", label: "Analytics", href: "/analytics" },
  { slug: "distribution", label: "Distribution", href: "/distribution" },
  { slug: "archive", label: "Archive", href: "/archive" },
];

export function TopBar() {
  const pathname = usePathname() ?? "/";
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const isActive = (href: string) => {
    if (href === "/library") return pathname === "/" || pathname.startsWith("/library");
    if (href === "/studio") return pathname.startsWith("/studio") || pathname.startsWith("/create");
    return pathname === href;
  };

  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-xl"
      style={{
        background: "linear-gradient(180deg, rgba(10,12,18,0.85), rgba(10,12,18,0.7))",
        borderBottom: "1px solid var(--color-brd)",
      }}
    >
      <div className="max-w-[1600px] mx-auto px-5 sm:px-8 lg:px-12 h-16 flex items-center gap-3 sm:gap-6 lg:gap-8">
        <Link href="/library" className="flex flex-col shrink-0 leading-none">
          <span className="font-display text-[1.05rem] sm:text-[1.15rem] font-extrabold tracking-tight title-grad">
            Music House
          </span>
          <span className="hidden sm:block label-mono-amber mt-1.5">
            Suno V5.5 · Mureka V8 · Distrokid
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 ml-2">
          {TABS.map((t) => {
            const active = isActive(t.href);
            return (
              <Link
                key={t.slug}
                href={t.href}
                className={
                  "relative px-3 lg:px-4 py-2 text-[0.74rem] lg:text-[0.78rem] font-display font-semibold rounded-md transition-colors " +
                  (active ? "tab-active" : "text-t3 hover:text-t1")
                }
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3 sm:gap-5">
          <label
            className="hidden sm:flex relative items-center"
            style={{ width: focused || q ? 280 : 200, transition: "width 0.32s cubic-bezier(0.2,0.8,0.2,1)" }}
          >
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-t3 text-[0.85rem] pointer-events-none">⌕</span>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Search tracks, albums…"
              className="font-mono text-[0.7rem] pl-8 pr-3 h-8 w-full rounded-md border outline-none bg-surface/80 transition-colors text-t1 placeholder:text-t3/70"
              style={{ borderColor: focused || q ? "rgba(236,72,153,0.45)" : "var(--color-brd)" }}
            />
          </label>

          <a
            href="https://project-hub-olive-pi.vercel.app"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:flex font-mono text-[0.65rem] uppercase tracking-[0.22em] text-t3 hover:text-amber transition-colors items-center gap-1.5"
          >
            <span className="w-1 h-1 rounded-full bg-amber/60" />
            Hub
          </a>

          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="md:hidden w-9 h-9 grid place-items-center rounded-md border border-brd text-t2 hover:text-t1 hover:border-brd-a transition-colors"
            aria-label="Menu"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></>}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t border-brd bg-bg2/95 backdrop-blur-xl animate-fi">
          <nav className="max-w-[1600px] mx-auto px-5 py-3 flex flex-col gap-1">
            {TABS.map((t) => {
              const active = isActive(t.href);
              return (
                <Link
                  key={t.slug}
                  href={t.href}
                  className={
                    "px-3 py-2.5 rounded-md font-display text-[0.92rem] font-semibold transition-colors " +
                    (active ? "bg-pink/[0.08] text-pink" : "text-t2 hover:bg-paper/[0.025] hover:text-t1")
                  }
                >
                  {t.label}
                </Link>
              );
            })}
            <a
              href="https://project-hub-olive-pi.vercel.app"
              target="_blank"
              rel="noreferrer"
              className="mt-2 pt-2 px-3 py-2 border-t border-brd font-mono text-[0.65rem] uppercase tracking-[0.22em] text-amber hover:text-pink transition-colors"
            >
              ← Project Hub
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
