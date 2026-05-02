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

  const totalDuration = tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
  const totalMinutes = Math.round(totalDuration / 60);
  const totalHours = (totalDuration / 3600).toFixed(1);

  const genreCounts: Record<string, number> = {};
  for (const t of tracks) {
    const g = (t.genre ?? "unknown").toLowerCase();
    genreCounts[g] = (genreCounts[g] ?? 0) + 1;
  }
  const sortedGenres = Object.entries(genreCounts).sort(([, a], [, b]) => b - a).slice(0, 14);
  const maxGenre = sortedGenres[0]?.[1] ?? 1;

  const generatorCounts = {
    suno: tracks.filter((t) => t.generator === "suno").length,
    mureka: tracks.filter((t) => t.generator === "mureka").length,
    import: tracks.filter((t) => t.generator === "import").length,
  };

  return (
    <main className="max-w-[1600px] mx-auto px-8 lg:px-12 py-12 animate-fi">
      <div className="mb-12">
        <p className="label-mono-amber">Analytics / 2026</p>
        <h1 className="mt-3 font-display text-[3.25rem] lg:text-[3.75rem] font-extrabold leading-[0.95] tracking-tight text-t1">
          Analytics<span className="text-cyan/60">.</span>
        </h1>
        <p className="mt-3 max-w-xl text-[0.92rem] text-paper-dim leading-relaxed">
          Catalog-level totals, genre distribution, projected platform split, and ROI math.
        </p>
      </div>

      {/* big-stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <BigStat label="Total Tracks" value={tracks.length} sub={`${totalHours} hrs · ${totalMinutes} min`} />
        <BigStat
          label="Distributed"
          value={distributed}
          sub={`${distributedPct}% of catalog`}
          color="green"
        />
        <BigStat
          label="Est. Monthly"
          value={`$${monthlyEst.toFixed(2)}`}
          sub={`$${yearlyEst.toFixed(0)}/yr projected`}
          gradient
        />
        <BigStat
          label="Cost · ROI"
          value={`$${totalCost.toFixed(2)}`}
          sub={roi > 0 ? `${roi.toLocaleString()}× /yr ROI` : "—"}
          color="amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Genre distribution bar chart */}
        <section className="lg:col-span-2 rounded-xl border border-brd bg-card/60 backdrop-blur p-6">
          <div className="flex items-center justify-between mb-6">
            <p className="label-mono">Genre Distribution</p>
            <span className="label-mono">{Object.keys(genreCounts).length} genres</span>
          </div>
          <ul className="space-y-2.5">
            {sortedGenres.map(([genre, count]) => {
              const pct = (count / maxGenre) * 100;
              return (
                <li key={genre} className="grid grid-cols-[140px_1fr_40px] items-center gap-3">
                  <span className="font-mono text-[0.62rem] text-t2 truncate">{genre}</span>
                  <div className="h-2 rounded-full bg-paper/[0.04] overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: "linear-gradient(90deg, #8b5cf6, #ec4899)",
                      }}
                    />
                  </div>
                  <span className="font-mono text-[0.62rem] text-t3 text-right tabular-nums">{count}</span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Platform projected split */}
        <aside className="rounded-xl border border-brd bg-card/60 backdrop-blur p-6">
          <div className="flex items-center justify-between mb-6">
            <p className="label-mono">Projected Platform Split</p>
            <span className="label-mono">${monthlyEst.toFixed(0)}/mo</span>
          </div>
          <ul className="space-y-3">
            {PLATFORMS.map((p) => {
              const v = monthlyEst * p.share;
              return (
                <li key={p.name} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className="font-display text-[0.78rem] text-t1 truncate">{p.name}</span>
                  </div>
                  <span className="font-mono text-[0.65rem] text-t2 tabular-nums shrink-0">
                    ${v.toFixed(2)}
                    <span className="text-t4 ml-1">/mo</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-6 pt-5 border-t border-brd">
            <p className="label-mono mb-3">Generator</p>
            <ul className="space-y-2">
              <GenRow label="Suno" n={generatorCounts.suno} total={tracks.length} color="#ec4899" />
              <GenRow label="Mureka" n={generatorCounts.mureka} total={tracks.length} color="#8b5cf6" />
              {generatorCounts.import > 0 && (
                <GenRow label="Imported" n={generatorCounts.import} total={tracks.length} color="#94a3b8" />
              )}
            </ul>
          </div>
        </aside>
      </div>

      <section className="mt-10 rounded-xl border border-brd bg-card/40 backdrop-blur p-6">
        <p className="label-mono mb-3">Catalog</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <SmallStat label="Albums" n={albums.length} />
          <SmallStat label="Mureka" n={generatorCounts.mureka} />
          <SmallStat label="Suno" n={generatorCounts.suno} />
          <SmallStat label="Avg / Album" n={albums.length ? Math.round(tracks.length / albums.length) : 0} />
        </div>
      </section>
    </main>
  );
}

function BigStat({
  label,
  value,
  sub,
  gradient,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  gradient?: boolean;
  color?: "green" | "amber" | "purple" | "pink" | "cyan";
}) {
  const colorClass = {
    green: "text-green",
    amber: "text-amber",
    purple: "text-purple",
    pink: "text-pink",
    cyan: "text-cyan",
  }[color ?? "purple"];
  return (
    <div className="rounded-xl border border-brd bg-card/60 backdrop-blur p-5">
      <p className="label-mono">{label}</p>
      <p
        className={
          "mt-2 font-mono font-bold tabular-nums text-[2.4rem] leading-none " +
          (gradient ? "title-grad" : color ? colorClass : "text-t1")
        }
      >
        {value}
      </p>
      {sub && <p className="mt-2 font-mono text-[0.55rem] uppercase tracking-[0.16em] text-t3">{sub}</p>}
    </div>
  );
}

function SmallStat({ label, n }: { label: string; n: number }) {
  return (
    <div>
      <p className="label-mono">{label}</p>
      <p className="mt-1 font-mono text-[1.4rem] font-bold tabular-nums text-t1">{n}</p>
    </div>
  );
}

function GenRow({ label, n, total, color }: { label: string; n: number; total: number; color: string }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <li>
      <div className="flex items-center justify-between mb-1">
        <span className="font-display text-[0.72rem] text-t2">{label}</span>
        <span className="font-mono text-[0.6rem] text-t3 tabular-nums">{n} · {pct}%</span>
      </div>
      <div className="h-1 rounded bg-paper/[0.04] overflow-hidden">
        <div className="h-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </li>
  );
}
