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

const STAGES: Array<{ key: "generating" | "mixing" | "ready" | "distributed"; label: string; target: string }> = [
  { key: "generating", label: "Generating", target: "/studio" },
  { key: "mixing", label: "Mixing", target: "/library?stage=mixing" },
  { key: "ready", label: "Ready", target: "/library?stage=ready" },
  { key: "distributed", label: "Distributed", target: "/distribution" },
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
      <div className="px-6 pt-7 pb-7">
        <Link href="/library" onClick={onNav} className="block leading-none">
          <span className="font-display text-[0.95rem] font-semibold tracking-[-0.005em] text-paper">Music House</span>
        </Link>
      </div>

      <nav className="px-3 flex flex-col gap-px">
        {TABS.map((t) => {
          const active = isActive(t.href);
          return (
            <Link
              key={t.slug}
              href={t.href}
              onClick={onNav}
              className={
                "relative px-3 py-1.5 text-[0.78rem] font-display rounded-md transition-colors " +
                (active
                  ? "text-paper bg-paper/[0.05] font-medium"
                  : "text-paper-dim hover:text-paper hover:bg-paper/[0.025] font-normal")
              }
            >
              {active && (
                <span
                  className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r"
                  style={{ background: "linear-gradient(180deg, #ec4899, #8b5cf6)" }}
                />
              )}
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div className="mx-6 my-6 h-px bg-paper/[0.06]" />

      <div className="px-6 flex flex-col gap-1.5">
        {STAGES.map((s) => {
          const n = counts[s.key];
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
                "flex items-baseline justify-between gap-2 py-1 transition-colors group/stage " +
                (active ? "" : "")
              }
            >
              <span className={"font-mono text-[0.55rem] uppercase tracking-[0.18em] transition-colors " + (active ? "text-paper" : "text-paper-faint group-hover/stage:text-paper-dim")}>
                {s.label}
              </span>
              <span className={"font-mono text-[0.72rem] tabular-nums leading-none transition-colors " + (n === 0 ? "text-paper-faint/50" : "text-paper")}>
                {n}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mx-6 my-6 h-px bg-paper/[0.06]" />

      <div className="px-6 flex flex-col gap-1.5">
        <Stat label="Tracks" value={tracks.length} />
        <Stat label="Albums" value={albums.length} />
        <Stat label="Cost" value={`$${totalCost.toFixed(0)}`} />
        <Stat label="Est. monthly" value={`$${monthlyEst.toFixed(2)}`} accent />
      </div>

      <div className="mt-auto px-6 py-6">
        <a
          href="https://project-hub-olive-pi.vercel.app"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-mono text-[0.55rem] uppercase tracking-[0.2em] text-paper-faint hover:text-paper-dim transition-colors"
        >
          Hub
          <span className="text-[0.7rem] leading-none">↗</span>
        </a>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint">{label}</span>
      <span
        className={"font-mono text-[0.72rem] tabular-nums leading-none " + (accent ? "title-grad font-semibold" : "text-paper")}
      >
        {value}
      </span>
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
      <div className="lg:hidden flex items-center justify-between px-4 h-12 border-b border-paper/[0.06] sticky top-0 z-30 bg-bg2/90 backdrop-blur-xl">
        <Link href="/library" className="font-display font-medium text-[0.92rem] text-paper">Music House</Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-9 h-9 grid place-items-center rounded-md text-paper-dim hover:text-paper transition-colors"
          aria-label="Menu"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></>}
          </svg>
        </button>
      </div>

      <aside
        className="hidden lg:flex w-[220px] shrink-0 flex-col border-r border-paper/[0.05] bg-bg2/30 backdrop-blur-xl sticky top-0 h-screen z-30"
      >
        <SidebarBody />
      </aside>

      {open && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm animate-fi" onClick={() => setOpen(false)} />
          <aside className="lg:hidden fixed inset-y-0 left-0 z-50 w-[260px] border-r border-paper/[0.05] bg-bg2/95 backdrop-blur-xl flex flex-col animate-fi">
            <SidebarBody onNav={() => setOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}

export function Sidebar() {
  return (
    <Suspense fallback={<aside className="hidden lg:flex w-[220px] shrink-0 border-r border-paper/[0.05] bg-bg2/30" />}>
      <SidebarShell />
    </Suspense>
  );
}
