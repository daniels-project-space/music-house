"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type PitchTarget = { artistSlug: string; albumSlug?: string; title: string; pitchCopy?: string };

export default function DistributionPage() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const jobs = useQuery(api.distribution.listAll, {}) ?? [];
  const artists = useQuery(api.artists.list, {}) ?? [];
  const albums = useQuery(api.albums.list, {}) ?? [];
  const setDistributed = useMutation(api.tracks.setDistributed);
  const setComplete = useMutation(api.distribution.setComplete);
  const setStreamingIds = useMutation(api.artists.setStreamingIds);
  const [busy, setBusy] = useState<string | null>(null);
  // DistroKid is the only active distributor — RouteNote is retired.
  const distributor = "distrokid" as const;
  const analytics = useQuery(api.distributorAnalytics.latest, { distributor: "distrokid" });
  const [refreshing, setRefreshing] = useState(false);

  // Profile-continuity risk: released on DistroKid but no pinned Spotify id yet.
  // Until claimed + pinned, the next release can spawn a DUPLICATE Spotify profile
  // (splits streams, resets followers, breaks Release Radar continuity).
  const unpinned = artists.filter((a) => a.distrokidReleased && !a.spotifyArtistId);

  // Spotify pitch modal (Spotify-for-Artists copy — the manual algorithmic lever).
  const [pitchTarget, setPitchTarget] = useState<PitchTarget | null>(null);
  const [pitchText, setPitchText] = useState("");
  const [pitchLoading, setPitchLoading] = useState(false);
  const [pitchErr, setPitchErr] = useState<string | null>(null);

  // Release lead time (DistroKid) — days ahead to date the release. A future date
  // keeps the editorial-pitch / pre-save / Release Radar window open.
  const [leadDays, setLeadDays] = useState(21);

  // Inline "pin Spotify artist ID" on the continuity guard.
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [pinBusy, setPinBusy] = useState<string | null>(null);

  // Accept a full Spotify artist URL or a bare 22-char id; extract the id.
  const parseSpotifyArtistId = (raw: string): string | null => {
    const s = raw.trim();
    const m = s.match(/artist[/:]([A-Za-z0-9]{22})/) ?? s.match(/^([A-Za-z0-9]{22})$/);
    return m ? m[1] : null;
  };

  const pinArtist = async (slug: string) => {
    const id = parseSpotifyArtistId(pinInputs[slug] ?? "");
    if (!id) {
      alert("Paste a Spotify artist URL or 22-char id");
      return;
    }
    setPinBusy(slug);
    try {
      await setStreamingIds({ slug, spotifyArtistId: id });
      setPinInputs((p) => ({ ...p, [slug]: "" }));
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`);
    } finally {
      setPinBusy(null);
    }
  };

  const openPitch = async (t: PitchTarget) => {
    setPitchTarget(t);
    setPitchErr(null);
    // Already auto-generated (or previously generated) — show it instantly,
    // no need to burn another Claude call.
    if (t.pitchCopy) {
      setPitchText(t.pitchCopy);
      setPitchLoading(false);
      return;
    }
    setPitchText("");
    setPitchLoading(true);
    try {
      const r = await fetch("/api/pitch/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artistSlug: t.artistSlug, albumSlug: t.albumSlug, title: t.title }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "pitch failed");
      setPitchText(j.pitch ?? "");
    } catch (e) {
      setPitchErr((e as Error).message);
    } finally {
      setPitchLoading(false);
    }
  };

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

  // HyperFollow pre-save link resolution. distributionJobs.trackId only points at
  // the FIRST track of an album release, so a direct jobByTrack lookup covers
  // singles + that first track; every other track in the album needs the
  // albumId → hyperfollowUrl fallback below.
  const hyperfollowByAlbumId = new Map<string, string>();
  for (const j of jobs) {
    if (j.hyperfollowUrl && j.albumId) hyperfollowByAlbumId.set(j.albumId, j.hyperfollowUrl);
  }
  const albumIdBySlug = new Map<string, string>();
  for (const a of albums) albumIdBySlug.set(`${a.artistSlug}/${a.slug}`, a._id);
  const resolveHyperfollow = (t: (typeof tracks)[number]): string | undefined => {
    const direct = jobByTrack.get(t._id)?.hyperfollowUrl;
    if (direct) return direct;
    if (!t.albumSlug) return undefined;
    const albumId = albumIdBySlug.get(`${t.artistSlug}/${t.albumSlug}`);
    return albumId ? hyperfollowByAlbumId.get(albumId) : undefined;
  };

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
        body: JSON.stringify({ trackId, distributor, leadDays }),
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
            via DistroKid
          </span>
        </div>
        <a
          href="https://distrokid.com/dashboard/albums/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[0.62rem] uppercase tracking-[0.16em] px-3 py-1.5 rounded border text-cyan hover:bg-cyan/[0.06] transition-colors"
          style={{ borderColor: "rgba(6,182,212,0.4)" }}
        >
          Open DistroKid ↗
        </a>
      </div>
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
          <label className="ml-auto flex items-center gap-1.5" title="Days ahead to date the release — keeps the Spotify pitch / pre-save / Release Radar window open">
            <span className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-paper-faint">Release in</span>
            <input
              type="number"
              min={0}
              max={365}
              value={leadDays}
              onChange={(e) => setLeadDays(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
              className="w-12 bg-paper/[0.04] border border-brd rounded px-1.5 py-0.5 text-[0.7rem] text-t1 text-center tabular-nums outline-none focus:border-purple/50"
            />
            <span className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-paper-faint">days</span>
          </label>
          <button
            onClick={refreshAnalytics}
            disabled={refreshing}
            className="font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2.5 py-1 rounded border text-cyan hover:bg-cyan/[0.06] transition-colors disabled:opacity-40"
            style={{ borderColor: "rgba(6,182,212,0.4)" }}
          >
            {refreshing ? "Queueing…" : "Refresh stats"}
          </button>
        </div>

      {unpinned.length > 0 ? (
        <div
          className="mb-4 px-3.5 py-3 rounded-lg border"
          style={{ borderColor: "rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.06)" }}
        >
          <p className="font-display text-[0.82rem] font-bold text-red mb-1">
            ⚠ {unpinned.length} artist{unpinned.length > 1 ? "s" : ""} need a pinned Spotify profile
          </p>
          <p className="text-[0.74rem] text-paper-dim leading-relaxed mb-3">
            Claim each profile in{" "}
            <a href="https://artists.spotify.com" target="_blank" rel="noopener noreferrer" className="text-cyan underline">
              Spotify for Artists
            </a>
            , then paste the artist URL/ID below <em>before the next release</em> — otherwise DistroKid can create a
            duplicate profile (splits streams, resets followers, breaks Release Radar).
          </p>
          <div className="space-y-1.5">
            {unpinned.map((a) => (
              <div key={a.slug} className="flex items-center gap-2">
                <span className="font-display text-[0.74rem] text-paper w-32 truncate shrink-0">{a.name}</span>
                <input
                  value={pinInputs[a.slug] ?? ""}
                  onChange={(e) => setPinInputs((p) => ({ ...p, [a.slug]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") pinArtist(a.slug); }}
                  placeholder="open.spotify.com/artist/… or 22-char id"
                  className="flex-1 bg-paper/[0.04] border border-brd rounded px-2 py-1 text-[0.72rem] text-t1 outline-none focus:border-red/50"
                />
                <button
                  onClick={() => pinArtist(a.slug)}
                  disabled={pinBusy === a.slug || !(pinInputs[a.slug] ?? "").trim()}
                  className="font-mono text-[0.55rem] uppercase tracking-[0.12em] px-2.5 py-1 rounded border disabled:opacity-40"
                  style={{ borderColor: "rgba(29,185,84,0.5)", color: "#1db954" }}
                >
                  {pinBusy === a.slug ? "…" : "Pin"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <details className="mb-4 px-3.5 py-2.5 rounded-lg border bg-card" style={{ borderColor: "var(--color-brd)" }}>
          <summary className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-paper-faint cursor-pointer">
            Spotify algorithmic checklist (get into shuffle / Radio / Discover Weekly)
          </summary>
          <ul className="mt-2.5 space-y-1.5 text-[0.74rem] text-paper-dim leading-relaxed list-disc pl-4">
            <li>Set the <strong>“Release in N days”</strong> control above (default 21) so the release is future-dated and the pitch window stays open.</li>
            <li>Pitch every release in Spotify for Artists <strong>≥7 days before</strong> release date — use the “♪ Pitch” button on each release to generate the copy.</li>
            <li>Pin the Spotify artist ID after the first release so all releases land on one profile (Release Radar continuity).</li>
            <li>Consider enrolling tracks in <strong>Discovery Mode</strong> (S4A) — boosts Radio/autoplay for a royalty trade-off.</li>
            <li>Algorithmic pickup is driven by first-14-day engagement: save rate &gt;3.5%, stream-to-listener &gt;2.0, skip &lt;20%. Drive saves via the funnel + pre-save.</li>
          </ul>
        </details>

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
                    onClick={() => openPitch({ artistSlug: t.artistSlug, albumSlug: t.albumSlug, title: t.title })}
                    className="font-mono text-[0.55rem] uppercase tracking-[0.12em] px-2 py-1 rounded border mr-2"
                    style={{ borderColor: "#1db954", color: "#1db954" }}
                  >
                    ♪ Pitch
                  </button>
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
            done.slice(0, 80).map((t) => {
              const hyperfollowUrl = resolveHyperfollow(t);
              return (
                <Row key={t._id} track={t}>
                  {hyperfollowUrl ? (
                    <span className="inline-flex items-center gap-1 mr-2">
                      <a
                        href={hyperfollowUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Share your Spotify pre-save link"
                        className="font-mono text-[0.55rem] uppercase tracking-[0.12em] px-2 py-1 rounded border"
                        style={{ borderColor: "#a78bfa", color: "#a78bfa" }}
                      >
                        ⇪ Pre-save
                      </a>
                      <button
                        onClick={() => navigator.clipboard?.writeText(hyperfollowUrl).catch(() => {})}
                        title="Copy pre-save link"
                        className="font-mono text-[0.55rem] px-1.5 py-1 rounded border"
                        style={{ borderColor: "#a78bfa", color: "#a78bfa" }}
                      >
                        ⧉
                      </button>
                    </span>
                  ) : null}
                  <button
                    onClick={() =>
                      openPitch({ artistSlug: t.artistSlug, albumSlug: t.albumSlug, title: t.title, pitchCopy: t.pitchCopy })
                    }
                    title={t.pitchGeneratedAt ? `Generated ${new Date(t.pitchGeneratedAt).toLocaleString()}` : undefined}
                    className="font-mono text-[0.55rem] uppercase tracking-[0.12em] px-2 py-1 rounded border mr-2"
                    style={
                      t.pitchCopy
                        ? { borderColor: "#1db954", color: "#0a0a0a", background: "#1db954" }
                        : { borderColor: "#1db954", color: "#1db954" }
                    }
                  >
                    {t.pitchCopy ? "✓ Pitch ready" : "♪ Pitch"}
                  </button>
                  <button
                    onClick={() => setDistributed({ id: t._id as Id<"tracks">, distributed: false })}
                    className="font-mono text-[0.55rem] uppercase tracking-[0.12em] px-2 py-1 rounded border opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ borderColor: "#06b6d4", color: "#06b6d4" }}
                  >
                    Recall
                  </button>
                </Row>
              );
            })
          )}
        </Column>
      </div>

      {pitchTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setPitchTarget(null)}
        >
          <div
            className="w-full max-w-lg rounded-lg border bg-card p-4 shadow-xl"
            style={{ borderColor: "var(--color-brd)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="font-display text-[0.95rem] font-bold text-paper truncate">
                Spotify pitch — {pitchTarget.title}
              </h3>
              <button
                onClick={() => setPitchTarget(null)}
                className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-paper-faint hover:text-paper"
              >
                ✕ close
              </button>
            </div>
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.14em] text-paper-faint mb-2">
              Paste into Spotify for Artists → pitch a song (do this ≥7 days before release)
            </p>
            {pitchLoading ? (
              <p className="font-mono text-[0.7rem] text-paper-dim py-8 text-center">Writing pitch…</p>
            ) : pitchErr ? (
              <p className="font-mono text-[0.7rem] text-red py-4">{pitchErr}</p>
            ) : (
              <>
                <textarea
                  value={pitchText}
                  onChange={(e) => setPitchText(e.target.value)}
                  className="w-full bg-paper/[0.04] border border-brd rounded-md p-3 text-[0.75rem] text-t1 min-h-64 font-mono outline-none focus:border-purple/50 transition-colors leading-relaxed"
                />
                <button
                  onClick={() => navigator.clipboard?.writeText(pitchText).catch(() => {})}
                  className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] px-3 py-1.5 rounded border text-cyan hover:bg-cyan/[0.06] transition-colors"
                  style={{ borderColor: "rgba(6,182,212,0.4)" }}
                >
                  ⧉ Copy
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
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
