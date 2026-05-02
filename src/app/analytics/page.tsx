"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

const PLATFORMS = [
  { name: "Spotify", share: 0.35, color: "#1db954" },
  { name: "Apple Music", share: 0.25, color: "#fa233b" },
  { name: "Amazon Music", share: 0.12, color: "#ff9900" },
  { name: "YouTube Music", share: 0.15, color: "#ff0033" },
  { name: "SoundCloud", share: 0.07, color: "#ff5500" },
  { name: "Tidal", share: 0.06, color: "#00d4ff" },
];

export default function AnalyticsPage() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const albums = useQuery(api.albums.list, {}) ?? [];

  const distributed = tracks.filter((t) => t.distributed).length;
  const distributedPct = tracks.length ? Math.round((distributed / tracks.length) * 100) : 0;
  const totalCost = tracks.length * 0.025;
  const monthlyEst = distributed * 2.25 + tracks.length * 0.6;
  const yearlyEst = monthlyEst * 12;
  const roi = totalCost > 0 ? Math.round(yearlyEst / totalCost) : 0;
  const mixed = tracks.filter((t) => (t.rating ?? 0) >= 4).length;

  const genreCounts: Record<string, number> = {};
  for (const t of tracks) {
    const g = (t.genre ?? "unknown").toLowerCase();
    genreCounts[g] = (genreCounts[g] ?? 0) + 1;
  }
  const sortedGenres = Object.entries(genreCounts).sort(([, a], [, b]) => b - a).slice(0, 18);
  const maxGenre = sortedGenres[0]?.[1] ?? 1;

  return (
    <main className="px-5 sm:px-6 lg:px-8 pt-3 pb-32 animate-fi">
      {/* 6-card stats grid like legacy */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <Stat label="Total Tracks" value={tracks.length} />
        <Stat label="Distributed" value={distributed} sub={`${distributedPct}% of catalog`} accent="green" />
        <Stat label="Est. Monthly" value={`$${monthlyEst.toFixed(2)}`} sub={`$${yearlyEst.toFixed(0)}/yr`} highlight />
        <Stat label="Cost" value={`$${totalCost.toFixed(2)}`} sub={roi > 0 ? `ROI ${roi.toLocaleString()}×/yr` : "—"} />
        <Stat label="Mixed" value={mixed} accent="purple" />
        <Stat label="Albums" value={albums.length} />
      </section>

      {/* Genre + Platform inline */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-8 rounded-lg border border-brd bg-card p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-mono text-[0.55rem] uppercase tracking-[0.2em] text-paper-faint">Genre Distribution</h3>
            <span className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-paper-faint">{Object.keys(genreCounts).length} genres</span>
          </div>
          <ul className="space-y-1.5">
            {sortedGenres.map(([genre, count]) => {
              const pct = (count / maxGenre) * 100;
              return (
                <li key={genre} className="grid grid-cols-[140px_1fr_32px] items-center gap-3">
                  <span className="font-mono text-[0.58rem] text-paper-dim truncate text-right">{genre}</span>
                  <div className="h-[3px] rounded bg-paper/[0.04] overflow-hidden">
                    <div
                      className="h-full transition-all duration-700"
                      style={{ width: `${pct}%`, background: "linear-gradient(90deg, #8b5cf6, #ec4899)" }}
                    />
                  </div>
                  <span className="font-mono text-[0.55rem] text-paper text-right tabular-nums">{count}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <aside className="lg:col-span-4 rounded-lg border border-brd bg-card p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-mono text-[0.55rem] uppercase tracking-[0.2em] text-paper-faint">Platform Split</h3>
            <span className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-paper-faint">${monthlyEst.toFixed(0)}/mo</span>
          </div>
          <ul className="space-y-2">
            {PLATFORMS.map((p) => {
              const v = monthlyEst * p.share;
              return (
                <li key={p.name} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className="font-display text-[0.74rem] text-paper truncate">{p.name}</span>
                  </div>
                  <span className="font-mono text-[0.6rem] text-paper-dim tabular-nums shrink-0">
                    ${v.toFixed(2)}<span className="text-paper-faint text-[0.5rem] ml-0.5">/mo</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--color-rule-soft)" }}>
            <p className="font-mono text-[0.5rem] uppercase tracking-[0.18em] text-paper-faint mb-2">Generator</p>
            <ul className="space-y-1.5">
              <GenRow label="Suno" n={tracks.filter((t) => t.generator === "suno").length} total={tracks.length} color="#ec4899" />
              <GenRow label="Mureka" n={tracks.filter((t) => t.generator === "mureka").length} total={tracks.length} color="#8b5cf6" />
              {tracks.filter((t) => t.generator === "import").length > 0 && (
                <GenRow label="Imported" n={tracks.filter((t) => t.generator === "import").length} total={tracks.length} color="#94a3b8" />
              )}
            </ul>
          </div>
        </aside>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
  highlight,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "green" | "amber" | "purple" | "pink" | "cyan";
  highlight?: boolean;
}) {
  const colorClass = {
    green: "text-green",
    amber: "text-amber",
    purple: "text-purple",
    pink: "text-pink",
    cyan: "text-cyan",
  }[accent ?? "purple"];
  return (
    <div className="rounded-lg border border-brd bg-card p-3 transition-colors hover:border-brd-a">
      <p className="font-mono text-[0.5rem] uppercase tracking-[0.18em] text-paper-faint">{label}</p>
      <p
        className={
          "mt-1.5 font-mono text-[1.55rem] font-bold tabular-nums leading-none " +
          (highlight ? "title-grad" : accent ? colorClass : "text-paper")
        }
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 font-mono text-[0.5rem] uppercase tracking-[0.14em] text-paper-faint">{sub}</p>}
    </div>
  );
}

function GenRow({ label, n, total, color }: { label: string; n: number; total: number; color: string }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <li>
      <div className="flex items-center justify-between mb-1">
        <span className="font-display text-[0.7rem] text-paper-dim">{label}</span>
        <span className="font-mono text-[0.55rem] text-paper-faint tabular-nums">{n} · {pct}%</span>
      </div>
      <div className="h-[3px] rounded bg-paper/[0.04] overflow-hidden">
        <div className="h-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
    </li>
  );
}
