"use client";

import { useState } from "react";
import { PageHero, PageShell } from "@/components/page-hero";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";

type Generator = "suno" | "mureka";

export default function StudioPage() {
  const [generator, setGenerator] = useState<Generator>("suno");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [title, setTitle] = useState("");
  const [artistSlug, setArtistSlug] = useState("");
  const [albumSlug, setAlbumSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [enhanceLoading, setEnhanceLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const jobs = useQuery(api.jobs.list, {}) ?? [];
  const albums = useQuery(api.albums.list, {}) ?? [];
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const sunoAlbums = albums.filter((a) => a.artistSlug === "_suno");
  const trackCountByAlbum = new Map<string, number>();
  for (const t of tracks) {
    const k = `${t.artistSlug}/${t.albumSlug ?? "_singles"}`;
    trackCountByAlbum.set(k, (trackCountByAlbum.get(k) ?? 0) + 1);
  }

  const activeJobs = jobs.filter((j) => j.status === "pending" || j.status === "running");
  const recentJobs = jobs.slice().reverse().slice(0, 8);

  const enhance = async () => {
    if (!prompt.trim()) return;
    setEnhanceLoading(true);
    setFeedback(null);
    try {
      const r = await fetch("/api/enhance-prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, generator }),
      });
      const j = await r.json();
      if (r.ok && j.enhanced) {
        setPrompt(j.enhanced);
        setFeedback({ kind: "ok", msg: "Prompt enhanced" });
      } else {
        setFeedback({ kind: "err", msg: j.error ?? "enhance failed" });
      }
    } catch (e: unknown) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setEnhanceLoading(false);
    }
  };

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          generator,
          prompt,
          lyrics: lyrics || undefined,
          title: title || undefined,
          artistSlug: artistSlug || undefined,
          albumSlug: albumSlug || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      setFeedback({ kind: "ok", msg: `Job ${j.jobId.slice(-6)} dispatched` });
      setPrompt("");
      setLyrics("");
      setTitle("");
    } catch (e: unknown) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell>
      <PageHero
        kicker="Studio / 2026"
        title="Studio"
        emphasis="workshop"
        description="Generate a track or album. Pick the engine, write the prompt, hit go."
        accent="pink"
        stats={[
          { label: "Active", value: activeJobs.length, highlight: true },
          { label: "Total", value: jobs.length },
          { label: "Suno Albums", value: sunoAlbums.length },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* LEFT — generate panel */}
        <section className="lg:col-span-2 rounded-xl border border-brd bg-card/60 p-6 backdrop-blur">
          <div className="flex items-center justify-between mb-5">
            <p className="label-mono">Generate</p>
            <div className="flex items-center gap-1 text-[0.55rem] font-mono text-t3">
              <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse-dot" />
              Vault wired
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-6">
            {(["suno", "mureka"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGenerator(g)}
                className={
                  "p-4 rounded-md border font-display font-semibold text-[1rem] transition-all " +
                  (generator === g
                    ? g === "suno"
                      ? "border-pink/60 bg-pink/[0.08] text-pink"
                      : "border-purple/60 bg-purple/[0.08] text-purple"
                    : "border-brd text-t3 hover:border-brd-a hover:text-t2")
                }
              >
                <div>{g === "suno" ? "Suno V5.5" : "Mureka V8"}</div>
                <div className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-t3 mt-1">
                  {g === "suno" ? "Lyric-driven · vocal" : "Style-driven · instrumental + vocal"}
                </div>
              </button>
            ))}
          </div>

          <form onSubmit={generate} className="space-y-4">
            <Field label="Title" value={title} onChange={setTitle} placeholder="Untitled" />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="label-mono">Style / Prompt</span>
                <button
                  type="button"
                  onClick={enhance}
                  disabled={!prompt.trim() || enhanceLoading}
                  className="font-mono text-[0.55rem] uppercase tracking-[0.16em] text-purple hover:text-pink disabled:opacity-30 transition-colors"
                >
                  ✨ {enhanceLoading ? "enhancing…" : "enhance"}
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                required
                placeholder="lofi jazz piano with rain, late-night cafe ambience, vinyl crackle, melancholy"
                className="w-full bg-paper/[0.04] border border-brd rounded-md p-3 text-[0.85rem] text-t1 min-h-24 outline-none focus:border-purple/50 transition-colors leading-relaxed"
              />
            </div>
            <FieldArea
              label="Lyrics (optional)"
              value={lyrics}
              onChange={setLyrics}
              placeholder="[Verse 1]&#10;Lay them down where the rain wears thin…"
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Artist Slug" value={artistSlug} onChange={setArtistSlug} placeholder="cafe-vinyl" />
              <Field label="Album Slug" value={albumSlug} onChange={setAlbumSlug} placeholder="echoes" />
            </div>
            <button
              type="submit"
              disabled={submitting || !prompt.trim()}
              className="w-full mt-2 px-4 py-3 rounded-md font-display font-semibold text-[0.95rem] transition-all disabled:opacity-30 hover:translate-y-[-1px]"
              style={{
                background: "linear-gradient(90deg, #ec4899, #8b5cf6)",
                color: "white",
                boxShadow: "0 8px 24px rgba(236,72,153,0.18)",
              }}
            >
              {submitting ? "Dispatching…" : `Generate Track via ${generator === "suno" ? "Suno" : "Mureka"}`}
            </button>
            {feedback && (
              <div
                className={
                  "mt-3 p-3 rounded-md text-[0.78rem] font-mono " +
                  (feedback.kind === "ok"
                    ? "bg-green/[0.06] border border-green/30 text-green"
                    : "bg-red/[0.06] border border-red/30 text-red")
                }
              >
                {feedback.msg}
              </div>
            )}
          </form>
        </section>

        {/* RIGHT — Generation Queue */}
        <aside className="rounded-xl border border-brd bg-card/60 p-6 backdrop-blur">
          <div className="flex items-center justify-between mb-5">
            <p className="label-mono">Queue</p>
            <span className="label-mono">{activeJobs.length} active</span>
          </div>
          {recentJobs.length === 0 && (
            <div className="text-center py-8">
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-t4">No active generations</p>
            </div>
          )}
          <ul className="space-y-2">
            {recentJobs.map((j) => (
              <li key={j._id} className="rounded border border-brd/60 px-3 py-2 bg-paper/[0.015]">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="font-mono text-[0.55rem] uppercase tracking-[0.18em]"
                    style={{ color: j.generator === "suno" ? "#ec4899" : "#8b5cf6" }}
                  >
                    {j.generator}
                  </span>
                  <Status status={j.status} />
                </div>
                <p className="text-[0.78rem] text-t1 mt-1.5 truncate" title={j.prompt}>
                  {j.prompt}
                </p>
                <p className="font-mono text-[0.5rem] text-t4 mt-1">
                  {new Date(j.createdAt).toISOString().slice(11, 16)} UTC
                </p>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {/* Suno Albums sub-panel */}
      <section className="mt-16">
        <div className="flex items-baseline justify-between mb-7 pb-3" style={{ borderBottom: "1px solid rgba(236,72,153,0.35)" }}>
          <div className="flex items-baseline gap-3">
            <span className="text-[1.1rem] text-pink">◐</span>
            <h2 className="font-display text-[1.55rem] font-semibold tracking-tight text-pink">Suno Album Builder</h2>
          </div>
          <span className="label-mono">{sunoAlbums.length} albums · autocomplete to 10 each</span>
        </div>

        {sunoAlbums.length === 0 ? (
          <div className="rounded-xl border border-dashed border-brd p-8 text-center">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-t4">
              No Suno albums yet. Generate a track with artist <span className="text-pink">_suno</span> to start.
            </p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {sunoAlbums.map((a) => {
              const count = trackCountByAlbum.get(`_suno/${a.slug}`) ?? 0;
              const pct = Math.min(100, Math.round((count / 10) * 100));
              return (
                <Link
                  key={a._id}
                  href={`/library/_suno/${a.slug}`}
                  className="group block rounded-md border border-brd bg-paper/[0.015] hover:border-pink/40 transition-colors p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-display text-[0.92rem] font-semibold truncate text-t1">{a.name}</h3>
                    <span className="font-mono text-[0.55rem] text-t3 shrink-0 ml-2">
                      {count}/10
                    </span>
                  </div>
                  <p className="font-mono text-[0.55rem] uppercase tracking-[0.16em] text-pink/80 truncate">
                    {a.genre ?? "—"}
                  </p>
                  <div className="mt-3 h-1 bg-paper/[0.04] rounded overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: "linear-gradient(90deg, #ec4899, #8b5cf6)",
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.preventDefault();
                      await fetch("/api/autocomplete", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ artistSlug: "_suno", albumSlug: a.slug }),
                      });
                    }}
                    disabled={count >= 10}
                    className="mt-3 w-full font-mono text-[0.55rem] uppercase tracking-[0.16em] py-1.5 rounded border transition-colors disabled:opacity-30"
                    style={{
                      borderColor: count >= 10 ? "var(--color-brd)" : "rgba(251,191,36,0.4)",
                      color: count >= 10 ? "var(--color-t4)" : "#fbbf24",
                    }}
                  >
                    {count >= 10 ? "complete" : `+ autocomplete to 10`}
                  </button>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </PageShell>
  );
}

function Status({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string; label: string; pulse?: boolean }> = {
    pending: { bg: "rgba(148,163,184,0.12)", color: "#94a3b8", label: "QUEUED" },
    running: { bg: "rgba(251,191,36,0.16)", color: "#fbbf24", label: "RUNNING", pulse: true },
    complete: { bg: "rgba(52,211,153,0.16)", color: "#34d399", label: "DONE" },
    failed: { bg: "rgba(239,68,68,0.16)", color: "#ef4444", label: "FAIL" },
  };
  const s = styles[status] ?? styles.pending;
  return (
    <span
      className={
        "font-mono text-[0.5rem] uppercase tracking-[0.18em] px-2 py-0.5 rounded " +
        (s.pulse ? "animate-breathe" : "")
      }
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="label-mono block">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-paper/[0.04] border border-brd rounded-md p-2.5 text-[0.85rem] text-t1 outline-none focus:border-purple/50 transition-colors"
      />
    </label>
  );
}
function FieldArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="label-mono block">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-paper/[0.04] border border-brd rounded-md p-2.5 text-[0.78rem] text-t1 min-h-24 font-mono outline-none focus:border-purple/50 transition-colors"
      />
    </label>
  );
}
