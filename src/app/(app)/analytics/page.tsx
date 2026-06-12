"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

// Blended per-stream payout estimate (USD) used until DistroKid's bank reports
// real money (stores pay out on a ~2-3 month lag). Spotify ~0.003-0.004,
// Apple ~0.007, YT Music ~0.002 — 0.0035 is the standard blended figure.
const USD_PER_STREAM = 0.0035;

const STORE_COLORS: Record<string, string> = {
  spotify: "#1db954",
  apple: "#fa233b",
  itunes: "#fa233b",
  amazon: "#ff9900",
  youtube: "#ff0033",
  soundcloud: "#ff5500",
  tidal: "#00d4ff",
  deezer: "#a238ff",
  pandora: "#00a0ee",
};

function storeColor(store: string): string {
  const k = store.toLowerCase();
  for (const key of Object.keys(STORE_COLORS)) {
    if (k.includes(key)) return STORE_COLORS[key];
  }
  return "#8b5cf6";
}

type StatsItem = { store?: string; date?: string; streams: number };

export default function AnalyticsPage() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const albums = useQuery(api.albums.list, {}) ?? [];
  const snapshot = useQuery(api.distributorAnalytics.latest, { distributor: "distrokid" });
  const history = useQuery(api.distributorAnalytics.history, { distributor: "distrokid" }) ?? [];
  const [refreshing, setRefreshing] = useState(false);

  const distributed = tracks.filter((t) => t.distributed).length;
  const distributedPct = tracks.length ? Math.round((distributed / tracks.length) * 100) : 0;
  const mixed = tracks.filter((t) => (t.rating ?? 0) >= 4).length;

  const streams = snapshot?.streamsTotal ?? 0;
  const balance = snapshot?.balance ?? 0;
  const currency = snapshot?.currency ?? "USD";
  const estEarned = streams * USD_PER_STREAM;

  // Per-store / per-day breakdown out of the scraped amCharts payload.
  const items: StatsItem[] = useMemo(() => {
    try {
      return snapshot?.streamsItemsJson ? JSON.parse(snapshot.streamsItemsJson) : [];
    } catch {
      return [];
    }
  }, [snapshot?.streamsItemsJson]);

  const storeSplit = useMemo(() => {
    const byStore: Record<string, number> = {};
    for (const it of items) {
      if (!it.store) continue;
      byStore[it.store] = (byStore[it.store] ?? 0) + it.streams;
    }
    return Object.entries(byStore).sort(([, a], [, b]) => b - a);
  }, [items]);
  const storeTotal = storeSplit.reduce((s, [, n]) => s + n, 0);

  const genreCounts: Record<string, number> = {};
  for (const t of tracks) {
    const g = (t.genre ?? "unknown").toLowerCase();
    genreCounts[g] = (genreCounts[g] ?? 0) + 1;
  }
  const sortedGenres = Object.entries(genreCounts).sort(([, a], [, b]) => b - a).slice(0, 18);
  const maxGenre = sortedGenres[0]?.[1] ?? 1;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/analytics/refresh", { method: "POST" });
    } finally {
      setTimeout(() => setRefreshing(false), 4000);
    }
  };

  return (
    <main className="px-5 sm:px-6 lg:px-8 pt-3 pb-32 animate-fi">
      {/* 6-card stats grid — streams + money are REAL DistroKid figures */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <Stat label="Total Tracks" value={tracks.length} />
        <Stat label="Distributed" value={distributed} sub={`${distributedPct}% of catalog`} accent="green" />
        <Stat
          label="Streams"
          value={streams.toLocaleString()}
          sub={snapshot ? `DistroKid · upd ${ago(snapshot.fetchedAt)}` : "awaiting first pull"}
          highlight
        />
        <Stat
          label="Bank Balance"
          value={`$${balance.toFixed(2)}`}
          sub={balance > 0 ? currency : snapshot?.message ?? "stores pay ~2-3mo behind"}
          accent="green"
        />
        <Stat
          label="Est. Earned"
          value={`$${estEarned.toFixed(2)}`}
          sub={`${streams.toLocaleString()} × $${USD_PER_STREAM}/stream`}
          accent="purple"
        />
        <Stat label="Albums" value={albums.length} sub={`${mixed} mixed 4★+`} />
      </section>

      {/* Streams over time (real history, pulled every 2 days) + store split */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-5">
        <div className="lg:col-span-8 rounded-lg border border-brd bg-card p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-mono text-[0.55rem] uppercase tracking-[0.2em] text-paper-faint">Streams Over Time</h3>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-paper-faint hover:text-paper transition-colors disabled:opacity-40"
            >
              {refreshing ? "pulling…" : "refresh ↻"}
            </button>
          </div>
          {history.length >= 2 ? (
            <Spark
              data={history.map((h) => h.streamsTotal)}
              labels={history.map((h) => fmtDate(h.fetchedAt))}
            />
          ) : (
            <div className="h-[120px] flex items-center justify-center">
              <p className="font-mono text-[0.55rem] uppercase tracking-[0.16em] text-paper-faint">
                {history.length === 1
                  ? `1 data point (${history[0].streamsTotal.toLocaleString()} streams) — graph appears at the next 2-day pull`
                  : "no pulls yet — hit refresh"}
              </p>
            </div>
          )}
        </div>

        <aside className="lg:col-span-4 rounded-lg border border-brd bg-card p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-mono text-[0.55rem] uppercase tracking-[0.2em] text-paper-faint">Store Split</h3>
            <span className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-paper-faint">
              {storeTotal > 0 ? `${storeTotal.toLocaleString()} streams` : "real data"}
            </span>
          </div>
          {storeSplit.length > 0 ? (
            <ul className="space-y-2">
              {storeSplit.map(([store, n]) => (
                <li key={store} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: storeColor(store) }} />
                    <span className="font-display text-[0.74rem] text-paper truncate">{store}</span>
                  </div>
                  <span className="font-mono text-[0.6rem] text-paper-dim tabular-nums shrink-0">
                    {n.toLocaleString()}
                    <span className="text-paper-faint text-[0.5rem] ml-0.5">
                      {storeTotal ? `· ${Math.round((n / storeTotal) * 100)}%` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-mono text-[0.55rem] text-paper-faint leading-relaxed">
              Per-store numbers appear once DistroKid reports stream data (2–5 days after stores go live).
            </p>
          )}
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

      {/* Genre distribution (catalog) */}
      <section className="grid grid-cols-1 gap-3">
        <div className="rounded-lg border border-brd bg-card p-4">
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
      </section>
    </main>
  );
}

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// Dependency-free SVG area chart for the streams time series.
function Spark({ data, labels }: { data: number[]; labels: string[] }) {
  const width = 720;
  const height = 120;
  const pad = 4;
  const padBottom = 16;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = width - pad * 2;
  const h = height - pad - padBottom;
  const xAt = (i: number) => pad + (data.length === 1 ? w / 2 : (i / (data.length - 1)) * w);
  const yAt = (v: number) => pad + h - ((v - min) / range) * h;
  const line = data.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
  const area = `${line} L${xAt(data.length - 1).toFixed(1)},${(pad + h).toFixed(1)} L${xAt(0).toFixed(1)},${(pad + h).toFixed(1)} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[120px]" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke="#8b5cf6" strokeWidth="2" />
      <circle cx={xAt(data.length - 1)} cy={yAt(data[data.length - 1])} r="3" fill="#ec4899" />
      <text x={pad} y={height - 3} fill="var(--color-paper-faint, #888)" fontSize="9" fontFamily="monospace">
        {labels[0]}
      </text>
      <text x={width - pad} y={height - 3} fill="var(--color-paper-faint, #888)" fontSize="9" fontFamily="monospace" textAnchor="end">
        {labels[labels.length - 1]} · {data[data.length - 1].toLocaleString()}
      </text>
    </svg>
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
