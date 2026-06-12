"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export default function DistributionPage() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const jobs = useQuery(api.distribution.listAll, {}) ?? [];
  const setDistributed = useMutation(api.tracks.setDistributed);
  const setComplete = useMutation(api.distribution.setComplete);
  const [busy, setBusy] = useState<string | null>(null);
  const [distributor, setDistributor] = useState<"routenote" | "distrokid">("distrokid");
  const analytics = useQuery(api.distributorAnalytics.latest, { distributor: "distrokid" });
  const [refreshing, setRefreshing] = useState(false);

  const refreshAnalytics = async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/analytics/refresh", { method: "POST" });
      if (!r.ok) alert(`Failed to refresh: ${await r.text()}`);
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const jobByTrack = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) {
    const prev = jobByTrack.get(j.trackId);
    if (!prev || j._creationTime > prev._creationTime) jobByTrack.set(j.trackId, j);
  }

  const active = tracks.filter((t) => {
    if (t.distributed) return false;
    const j = jobByTrack.get(t._id);
    return j && (j.status === "pending" || j.status === "running" || j.status === "draft_ready");
  });
  const ready = tracks.filter((t) => {
    if (t.distributed || t.archivedAt) return false;
    const j = jobByTrack.get(t._id);
    return !j || j.status === "failed";
  });
  const done = tracks.filter((t) => t.distributed);

  const startDistribute = async (trackId: Id<"tracks">) => {
    setBusy(trackId);
    try {
      const r = await fetch("/api/distribute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trackId, distributor }),
      });
      if (!r.ok) alert(`Failed to start: ${await r.text()}`);
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="px-5 sm:px-6 lg:px-8 pt-3 pb-32 animate-fi">
      <div className="flex items-baseline justify-between gap-3 mb-4 pb-3" style={{ borderBottom: "1px solid var(--color-brd)" }}>
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-[1.05rem] font-bold tracking-tight text-paper">Distribution</h1>
          <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint">
            via {distributor === "distrokid" ? "DistroKid" : "RouteNote"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded border overflow-hidden" style={{ borderColor: "var(--color-brd)" }}>
            {(["distrokid", "routenote"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDistributor(d)}
                className="font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2.5 py-1.5 transition-colors"
                style={
                  distributor === d
                    ? { background: "rgba(6,182,212,0.12)", color: "#06b6d4" }
                    : { color: "var(--color-paper-faint, #9ca3af)" }
                }
              >
                {d === "distrokid" ? "DistroKid" : "RouteNote"}
              </button>
            ))}
          </div>
          <a
            href={
              distributor === "distrokid"
                ? "https://distrokid.com/dashboard/albums/"
                : "https://www.routenote.com/rn/releases"
            }
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[0.62rem] uppercase tracking-[0.16em] px-3 py-1.5 rounded border text-cyan hover:bg-cyan/[0.06] transition-colors"
            style={{ borderColor: "rgba(6,182,212,0.4)" }}
          >
            {distributor === "distrokid" ? "Open DistroKid ↗" : "Open RouteNote ↗"}
          </a>
        </div>
      </div>
      {distributor === "distrokid" ? (
        <div
          className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4 px-3.5 py-2.5 rounded-lg border bg-card"
          style={{ borderColor: "var(--color-brd)" }}
        >
          <Metric label="Streams" value={analytics ? analytics.streamsTotal.toLocaleString() : "—"} />
          <Metric
            label="Balance"
            value={
              analytics
                ? (analytics.currency === "GBP" ? "£" : analytics.currency === "USD" ? "$" : "€") +
                  analytics.balance.toFixed(2)
                : "—"
            }
          />
          <span className="font-mono text-[0.5rem] uppercase tracking-[0.14em] text-paper-faint">
            {analytics
              ? "as of " + new Date(analytics.fetchedAt).toLocaleString()
              : "no snapshot yet — hit refresh"}
            {analytics?.streamsPending ? " · ingestion pending" : ""}
          </span>
          <button
            onClick={refreshAnalytics}
            disabled={refreshing}
            className="ml-auto font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2.5 py-1 rounded border text-cyan hover:bg-cyan/[0.06] transition-colors disabled:opacity-40"
            style={{ borderColor: "rgba(6,182,212,0.4)" }}
          >
            {refreshing ? "Queueing…" : "Refresh stats"}
          </button>
        </div>
      ) : null}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Column color="#34d399" label="Ready">
          {ready.length === 0 ? (
            <Empty />
          ) : (
            ready.slice(0, 80).map((t) => {
              const j = jobByTrack.get(t._id);
              return (
                <Row key={t._id} track={t}>
                  {j?.status === "failed" ? (
                    <span className="font-mono text-[0.5rem] uppercase tracking-[0.12em] text-red mr-2" title={j.error ?? ""}>
                      failed
                    </span>
                  ) : null}
                  <button
                    onClick={() => startDistribute(t._id as Id<"tracks">)}
                    disabled={busy === t._id}
                    className="font-mono text-[0.55rem] uppercase tracking-[0.12em] px-2 py-1 rounded border opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40"
                    style={{ borderColor: "#34d399", color: "#34d399" }}
                  >
                    {busy === t._id ? "…" : "Distribute"}
                  </button>
                </Row>
              );
            })
          )}
        </Column>

        <Column color="#fbbf24" label="In Progress">
          {active.length === 0 ? (
            <Empty />
          ) : (
            active.map((t) => {
              const j = jobByTrack.get(t._id)!;
              const statusLabel =
                j.status === "pending"
                  ? "queued"
                  : j.status === "running"
                    ? "agent working"
                    : "draft ready";
              return (
                <Row key={t._id} track={t}>
                  <span
                    className="font-mono text-[0.5rem] uppercase tracking-[0.14em] text-paper-faint mr-2 max-w-[200px] truncate"
                    title={j.progress ?? statusLabel}
                  >
                    {j.status === "running" && j.progress ? j.progress : statusLabel}
                  </span>
                  {j.liveViewUrl ? (
                    <a
                      href={j.liveViewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[0.55rem] uppercase tracking-[0.12em] px-2 py-1 rounded border mr-2"
                      style={{ borderColor: "#fbbf24", color: "#fbbf24" }}
                    >
                      Live view ↗
                    </a>
                  ) : null}
                  <button
                    onClick={() => setComplete({ id: j._id, releaseUrl: undefined })}
                    className="font-mono text-[0.55rem] uppercase tracking-[0.12em] px-2 py-1 rounded border"
                    style={{ borderColor: "#06b6d4", color: "#06b6d4" }}
                  >
                    Done
                  </button>
                </Row>
              );
            })
          )}
        </Column>

        <Column color="#06b6d4" label="Distributed">
          {done.length === 0 ? (
            <Empty />
          ) : (
            done.slice(0, 80).map((t) => (
              <Row key={t._id} track={t}>
                <button
                  onClick={() => setDistributed({ id: t._id as Id<"tracks">, distributed: false })}
                  className="font-mono text-[0.55rem] uppercase tracking-[0.12em] px-2 py-1 rounded border opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ borderColor: "#06b6d4", color: "#06b6d4" }}
                >
                  Recall
                </button>
              </Row>
            ))
          )}
        </Column>
      </div>
    </main>
  );
}

function Column({
  color,
  label,
  children,
}: {
  color: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-brd bg-card p-4">
      <div
        className="flex items-center justify-between mb-3 pb-2"
        style={{ borderBottom: "1px solid " + color + "30" }}
      >
        <h3 className="font-display text-[0.92rem] font-bold tracking-tight" style={{ color }}>
          {label}
        </h3>
      </div>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-paper-faint">{label}</span>
      <span className="font-display text-[0.95rem] font-bold text-paper">{value}</span>
    </div>
  );
}

function Empty() {
  return (
    <li className="text-center py-10 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint/60">
      empty
    </li>
  );
}

type T = { _id: string; title: string; artistSlug: string; albumSlug?: string };

function Row({ track, children }: { track: T; children: React.ReactNode }) {
  return (
    <li className="group flex items-center gap-3 px-2.5 py-1.5 rounded hover:bg-paper/[0.04] transition-colors">
      <div className="min-w-0 flex-1">
        <div className="text-[0.78rem] font-display text-paper truncate leading-tight">{track.title}</div>
        <div className="font-mono text-[0.52rem] uppercase tracking-[0.12em] text-paper-faint truncate mt-0.5">
          {track.artistSlug}
          {track.albumSlug ? " · " + track.albumSlug : ""}
        </div>
      </div>
      {children}
    </li>
  );
}
