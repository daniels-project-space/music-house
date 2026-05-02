"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { PageHero, PageShell } from "@/components/page-hero";

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
  const totalHours = (totalDuration / 3600).toFixed(1);

  const genreCounts: Record<string, number> = {};
  for (const t of tracks) {
    const g = (t.genre ?? "unknown").toLowerCase();
    genreCounts[g] = (genreCounts[g] ?? 0) + 1;
  }
  const sortedGenres = Object.entries(genreCounts).sort(([, a], [, b]) => b - a).slice(0, 12);
  const maxGenre = sortedGenres[0]?.[1] ?? 1;

  const generatorCounts = {
    suno: tracks.filter((t) => t.generator === "suno").length,
    mureka: tracks.filter((t) => t.generator === "mureka").length,
    import: tracks.filter((t) => t.generator === "import").length,
  };

  return (
    <PageShell>
      <PageHero
        kicker="Analytics / 2026"
        title="Analytics"
        emphasis="report"
        description="Catalog totals, genre balance, projected platform split, ROI math. Read at a glance."
        accent="cyan"
        stats={[
          { label: "Tracks", value: tracks.length },
          { label: "Albums", value: albums.length },
          { label: "Hours", value: totalHours },
        ]}
      />

      <div className="space-y-16">
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <BigStat label="Distributed" value={distributed} sub={`${distributedPct}% of catalog`} accent="green" />
          <BigStat label="Est. Monthly" value={`$${monthlyEst.toFixed(2)}`} sub={`$${yearlyEst.toFixed(0)}/yr projected`} highlight />
          <BigStat label="Cost" value={`$${totalCost.toFixed(2)}`} sub="Cumulative spend" accent="amber" />
          <BigStat label="ROI" value={roi > 0 ? `${roi.toLocaleString()}×` : "—"} sub="vs. yearly est." accent="purple" />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 rounded-2xl border border-rule-soft bg-card/50 backdrop-blur p-7">
            <div className="flex items-center justify-between mb-7 pb-3 border-b border-rule-soft/60">
              <h3 className="font-display text-[1.25rem] font-semibold tracking-tight text-paper">Genre Distribution</h3>
              <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-paper-faint">{Object.keys(genreCounts).length} genres</span>
            </div>
            <ul className="space-y-3">
              {sortedGenres.map(([genre, count]) => {
                const pct = (count / maxGenre) * 100;
                return (
                  <li key={genre} className="grid grid-cols-[160px_1fr_44px] items-center gap-4">
                    <span className="font-mono text-[0.66rem] text-paper-dim truncate">{genre}</span>
                    <div className="h-[7px] rounded-full bg-paper/[0.04] overflow-hidden">
                      <div
                        className="h-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: "linear-gradient(90deg, #8b5cf6, #ec4899)" }}
                      />
                    </div>
                    <span className="font-mono text-[0.66rem] text-paper text-right tabular-nums">{count}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <aside className="lg:col-span-2 rounded-2xl border border-rule-soft bg-card/50 backdrop-blur p-7">
            <div className="flex items-center justify-between mb-7 pb-3 border-b border-rule-soft/60">
              <h3 className="font-display text-[1.25rem] font-semibold tracking-tight text-paper">Platform Split</h3>
              <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-paper-faint">${monthlyEst.toFixed(0)}/mo</span>
            </div>
            <ul className="space-y-3.5">
              {PLATFORMS.map((p) => {
                const v = monthlyEst * p.share;
                return (
                  <li key={p.name} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                      <span className="font-display text-[0.86rem] text-paper truncate">{p.name}</span>
                    </div>
                    <span className="font-mono text-[0.7rem] text-paper-dim tabular-nums shrink-0">
                      ${v.toFixed(2)}
                      <span className="text-t4 text-[0.55rem] ml-1">/mo</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-7 pt-6 border-t border-rule-soft/60">
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-paper-faint mb-4">Generator</p>
              <ul className="space-y-3">
                <GenRow label="Suno" n={generatorCounts.suno} total={tracks.length} color="#ec4899" />
                <GenRow label="Mureka" n={generatorCounts.mureka} total={tracks.length} color="#8b5cf6" />
                {generatorCounts.import > 0 && <GenRow label="Imported" n={generatorCounts.import} total={tracks.length} color="#94a3b8" />}
              </ul>
            </div>
          </aside>
        </section>
      </div>
    </PageShell>
  );
}

function BigStat({
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
    <div className="rounded-2xl border border-rule-soft bg-card/50 backdrop-blur p-6">
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-paper-faint">{label}</p>
      <p
        className={
          "mt-3 font-display text-[2.6rem] font-extrabold tabular-nums leading-none " +
          (highlight ? "title-grad" : accent ? colorClass : "text-paper")
        }
      >
        {value}
      </p>
      {sub && <p className="mt-3 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-paper-faint">{sub}</p>}
    </div>
  );
}

function GenRow({ label, n, total, color }: { label: string; n: number; total: number; color: string }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <li>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-display text-[0.78rem] text-paper-dim">{label}</span>
        <span className="font-mono text-[0.62rem] text-paper-faint tabular-nums">{n} · {pct}%</span>
      </div>
      <div className="h-[5px] rounded bg-paper/[0.04] overflow-hidden">
        <div className="h-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
    </li>
  );
}
