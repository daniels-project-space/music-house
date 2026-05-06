"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Suspense, useEffect, useState } from "react";

const TABS: Array<{ slug: string; label: string; href: string }> = [
  { slug: "library", label: "Library", href: "/library" },
  { slug: "studio", label: "Studio", href: "/studio" },
  { slug: "analytics", label: "Analytics", href: "/analytics" },
  { slug: "distribution", label: "Distribution", href: "/distribution" },
  { slug: "archive", label: "Archive", href: "/archive" },
];

const STAGES: Array<{ key: "generating" | "mixing" | "ready" | "distributed"; label: string; icon: string; color: string; target: string }> = [
  { key: "generating", label: "Generating", icon: "⚡", color: "#ec4899", target: "/studio" },
  { key: "mixing", label: "Mixing", icon: "▦", color: "#8b5cf6", target: "/library?stage=mixing" },
  { key: "ready", label: "Ready", icon: "✓", color: "#34d399", target: "/library?stage=ready" },
  { key: "distributed", label: "Distributed", icon: "📡", color: "#06b6d4", target: "/distribution" },
];

function SidebarBody({ onNav }: { onNav?: () => void }) {
  const pathname = usePathname() ?? "/";
  const sp = useSearchParams();
  const activeStage = sp?.get("stage");
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const albums = useQuery(api.albums.list, {}) ?? [];
  const jobs = useQuery(api.jobs.list, {}) ?? [];

  const counts = {
    generating: jobs.filter((j) => j.status === "running" || j.status === "pending").length,
    mixing: 0,
    ready: tracks.filter((t) => !t.distributed && !t.archivedAt).length,
    distributed: tracks.filter((t) => t.distributed).length,
  } as const;
  const totalCost = tracks.length * 0.025;
  const monthlyEst = counts.distributed * 2.25 + tracks.length * 0.6;

  const isActive = (href: string) => {
    if (href === "/library") return pathname === "/" || pathname.startsWith("/library");
    if (href === "/studio") return pathname.startsWith("/studio") || pathname.startsWith("/create");
    return pathname === href;
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-5 pt-6 pb-5">
        <Link href="/library" onClick={onNav} className="flex flex-col leading-none group/logo">
          <span className="font-display text-[1.15rem] font-extrabold tracking-[-0.01em] title-grad">Music House</span>
          <span className="font-mono text-[0.46rem] uppercase tracking-[0.22em] text-paper-faint mt-2">Suno V5.5 · Mureka V8</span>
        </Link>
      </div>

      <nav className="px-3 pb-2 flex flex-col gap-0.5">
        {TABS.map((t) => {
          const active = isActive(t.href);
          return (
            <Link
              key={t.slug}
              href={t.href}
              onClick={onNav}
              className={
                "px-3 py-2 text-[0.82rem] font-display font-semibold rounded-md transition-colors flex items-center gap-2 " +
                (active ? "tab-active" : "text-paper-dim hover:text-paper hover:bg-purple/[0.05]")
              }
            >
              {active && <span className="w-1 h-1 rounded-full bg-pink shadow-[0_0_6px_rgba(236,72,153,0.7)]" />}
              <span className={active ? "" : "ml-3"}>{t.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-5 pt-5 pb-3 mt-2 border-t border-brd/40">
        <p className="font-mono text-[0.5rem] uppercase tracking-[0.22em] text-paper-faint mb-3">Pipeline</p>
        <div className="flex flex-col gap-1">
          {STAGES.map((s) => {
            const n = counts[s.key];
            const dim = n === 0;
            const active =
              (s.key === "generating" && pathname.startsWith("/studio")) ||
              (s.key === "distributed" && pathname.startsWith("/distribution")) ||
              activeStage === s.key;
            return (
              <Link
                key={s.key}
                href={s.target}
                onClick={onNav}
                className={
                  "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded transition-colors " +
                  (active ? "bg-paper/[0.04]" : "hover:bg-paper/[0.025]")
                }
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <span style={{ color: dim ? "rgba(148,163,184,0.4)" : s.color, filter: active ? `drop-shadow(0 0 6px ${s.color})` : "none" }} className="text-[0.95rem] leading-none w-4 text-center">
                    {s.icon}
                  </span>
                  <span className={"font-mono text-[0.55rem] uppercase tracking-[0.16em] " + (active ? "text-paper" : "text-paper-faint")}>{s.label}</span>
                </span>
                <span
                  className="font-mono text-[0.78rem] font-bold tabular-nums leading-none"
                  style={{ color: dim ? "rgba(148,163,184,0.45)" : s.color }}
                >
                  {n}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="px-5 pt-4 pb-4 border-t border-brd/40">
        <p className="font-mono text-[0.5rem] uppercase tracking-[0.22em] text-paper-faint mb-3">Stats</p>
        <div className="flex flex-col gap-2.5">
          <Stat label="Tracks" value={tracks.length} />
          <Stat label="Albums" value={albums.length} />
          <Stat label="Cost" value={`$${totalCost.toFixed(0)}`} />
          <Stat label="Est. Monthly" value={`$${monthlyEst.toFixed(2)}`} gradient />
        </div>
      </div>

      <div className="mt-auto px-5 py-4 border-t border-brd/40">
        <a
          href="https://project-hub-olive-pi.vercel.app"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 font-mono text-[0.55rem] uppercase tracking-[0.22em] text-paper-faint hover:text-amber transition-colors"
        >
          <span className="w-1 h-1 rounded-full bg-amber/70" />
          Project Hub
        </a>
      </div>
    </div>
  );
}

function Stat({ label, value, gradient }: { label: string; value: string | number; gradient?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-mono text-[0.5rem] uppercase tracking-[0.18em] text-paper-faint">{label}</span>
      <span className={"font-mono text-[0.85rem] font-bold tabular-nums leading-none " + (gradient ? "title-grad" : "text-paper")}>{value}</span>
    </div>
  );
}

function SidebarShell() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <div className="lg:hidden flex items-center justify-between px-4 h-12 border-b border-brd sticky top-0 z-30 bg-bg2/90 backdrop-blur-xl">
        <Link href="/library" className="font-display font-bold text-[0.95rem] title-grad">Music House</Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-9 h-9 grid place-items-center rounded-md border border-brd text-paper-dim hover:text-paper transition-colors"
          aria-label="Menu"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></>}
          </svg>
        </button>
      </div>

      <aside
        className={
          "hidden lg:flex w-60 shrink-0 flex-col border-r border-brd/60 bg-bg2/40 backdrop-blur-xl sticky top-0 h-screen z-30"
        }
      >
        <SidebarBody />
      </aside>

      {open && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm animate-fi" onClick={() => setOpen(false)} />
          <aside className="lg:hidden fixed inset-y-0 left-0 z-50 w-72 border-r border-brd bg-bg2/95 backdrop-blur-xl flex flex-col animate-fi">
            <SidebarBody onNav={() => setOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}

export function Sidebar() {
  return (
    <Suspense fallback={<aside className="hidden lg:flex w-60 shrink-0 border-r border-brd/60 bg-bg2/40" />}>
      <SidebarShell />
    </Suspense>
  );
}
