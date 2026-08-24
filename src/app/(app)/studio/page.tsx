"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { TrackRow, useHeartedSet } from "@/components/track-row";
import type { PlayerTrack } from "@/components/player-context";

type Feedback = { kind: "ok" | "err"; message: string } | null;

export default function StudioPage() {
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const jobs = useQuery(api.jobs.list, {}) ?? [];
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const hearted = useHeartedSet();

  const activeJobs = [...jobs]
    .filter((job) => job.status === "pending" || job.status === "running")
    .sort((a, b) => b.createdAt - a.createdAt);
  const displayedActiveJobs = activeJobs.slice(0, 3);
  const failedJobs = [...jobs]
    .filter((job) => job.status === "failed")
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3);
  const finishedTracks = [...tracks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 30);
  const queue: PlayerTrack[] = finishedTracks.map((track) => ({
    id: track._id,
    title: track.title,
    artist: track.artistSlug,
    album: track.albumSlug,
    audioUrl: "",
  }));

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          generator: "suno",
          title: title || undefined,
          genre: genre || undefined,
          prompt,
          lyrics: lyrics || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not start the render");

      setFeedback({
        kind: "ok",
        message: lyrics.trim()
          ? "Lyrics saved. Your song is rendering below."
          : "Your song is rendering below.",
      });
      setTitle("");
      setPrompt("");
      setLyrics("");
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Could not start the render",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const enhance = async () => {
    if (!prompt.trim()) return;
    setEnhancing(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/enhance-prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, genre, lyrics }),
      });
      const result = await response.json();
      if (!response.ok || !result.enhanced) throw new Error(result.error ?? "Could not enhance the brief");
      setPrompt(result.enhanced);
      setFeedback({ kind: "ok", message: "Suno-ready structure added. Review it, then generate when it feels right." });
    } catch (error) {
      setFeedback({
        kind: "err",
        message: error instanceof Error ? error.message : "Could not enhance the brief",
      });
    } finally {
      setEnhancing(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-5 pb-32 pt-5 sm:px-6 lg:px-8 animate-fi">
      <header className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="label-mono">Music House Studio</p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-t1">Make a song</h1>
          <p className="mt-1 text-sm text-t3">Write one clear brief. Finished songs appear right here.</p>
        </div>
        <Link
          href="/library"
          className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-purple transition-colors hover:text-pink"
        >
          Open full library →
        </Link>
      </header>

      <section className="rounded-lg border border-brd bg-card p-4 sm:p-5">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="label-mono">Suno renderer</p>
            <p className="mt-1 font-mono text-[0.58rem] uppercase tracking-[0.14em] text-t4">
              Your brief is sent directly — no hidden prompt rewriting
            </p>
          </div>
          <span className="rounded-full border border-pink/30 bg-pink/[0.07] px-2 py-1 font-mono text-[0.55rem] uppercase tracking-[0.14em] text-pink">
            V5.5
          </span>
        </div>

        <form onSubmit={generate} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Title (optional)" value={title} onChange={setTitle} placeholder="Midnight Study Sessions" />
            <TextField label="Genre / sound" value={genre} onChange={setGenre} placeholder="Warm indie folk, lo-fi house…" />
          </div>

          <label className="block space-y-1.5">
            <span className="flex items-center justify-between gap-3">
              <span className="label-mono block">What should it sound like?</span>
              <button
                type="button"
                onClick={enhance}
                disabled={enhancing || !prompt.trim()}
                className="font-mono text-[0.58rem] uppercase tracking-[0.14em] text-purple transition-colors hover:text-pink disabled:cursor-not-allowed disabled:opacity-35"
              >
                {enhancing ? "Enhancing…" : "✦ Enhance for Suno"}
              </button>
            </span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              required
              placeholder="Intimate female vocal, brushed drums, tape warmth, a rainy midnight train ride. Build gently, then open into a hopeful chorus."
              className="min-h-28 w-full rounded-md border border-brd bg-paper/[0.04] p-3 text-[0.9rem] leading-relaxed text-t1 outline-none transition-colors focus:border-purple/50"
            />
            <p className="text-[0.72rem] text-t3">
              Describe instruments, voice, mood, tempo, and song structure. Avoid artist names — Suno rejects those requests.
            </p>
          </label>

          <details className="rounded-md border border-brd/70 bg-paper/[0.015] px-3 py-2.5">
            <summary className="cursor-pointer font-mono text-[0.6rem] uppercase tracking-[0.14em] text-t2">
              Suno prompt guide
            </summary>
            <ul className="mt-3 space-y-1.5 pl-4 text-[0.75rem] leading-relaxed text-t3 marker:text-purple list-disc">
              <li>Lead with genre, then name the mood, instruments, vocal character, and energy or tempo.</li>
              <li>Describe the journey: how it opens, builds, peaks, and ends. One clear direction beats conflicting ideas.</li>
              <li>For custom lyrics, use labels such as <span className="font-mono text-t2">[Verse]</span>, <span className="font-mono text-t2">[Chorus]</span>, and <span className="font-mono text-t2">[Bridge]</span>.</li>
              <li>Use musical traits instead of naming artists. The enhancer keeps your idea and adds a focused arrangement prompt.</li>
            </ul>
          </details>

          <details className="rounded-md border border-brd/70 bg-paper/[0.015] px-3 py-2.5">
            <summary className="cursor-pointer font-mono text-[0.6rem] uppercase tracking-[0.14em] text-t2">
              Add or reuse lyrics (optional)
            </summary>
            <div className="mt-3 space-y-3">
              <SavedLyricsPicker
                onPick={(savedTitle, savedLyrics) => {
                  if (!title.trim()) setTitle(savedTitle);
                  setLyrics(savedLyrics);
                }}
              />
              <textarea
                value={lyrics}
                onChange={(event) => setLyrics(event.target.value)}
                placeholder={'[Verse 1]\nLay them down where the rain wears thin…'}
                className="min-h-36 w-full rounded-md border border-brd bg-paper/[0.04] p-3 font-mono text-[0.78rem] leading-relaxed text-t1 outline-none transition-colors focus:border-purple/50"
              />
              <p className="text-[0.72rem] text-t3">Lyrics are saved to your lyric library when you start a render.</p>
            </div>
          </details>

          <button
            type="submit"
            disabled={submitting || !prompt.trim()}
            className="w-full rounded-md px-4 py-3 font-display text-[1rem] font-semibold text-white transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-35"
            style={{
              background: "linear-gradient(90deg, #ec4899, #8b5cf6)",
              boxShadow: "0 8px 24px rgba(236,72,153,0.18)",
            }}
          >
            {submitting ? "Starting render…" : "Generate song"}
          </button>

          {feedback ? <FeedbackNotice feedback={feedback} /> : null}
        </form>
      </section>

      <section id="finished-songs" className="mt-5 rounded-lg border border-brd bg-card p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-brd/70 pb-3">
          <div>
            <p className="label-mono">Rendering now</p>
            <p className="mt-1 text-xs text-t3">Keep this page open if you like; completed songs will appear below automatically.</p>
          </div>
          <span className="label-mono">{activeJobs.length} active</span>
        </div>

        {activeJobs.length ? (
          <div className="space-y-2">
            {displayedActiveJobs.map((job) => <RenderBuffer key={job._id} job={job} />)}
            {activeJobs.length > displayedActiveJobs.length ? (
              <Link
                href="/jobs"
                className="block pt-1 text-center font-mono text-[0.58rem] uppercase tracking-[0.15em] text-purple transition-colors hover:text-pink"
              >
                View {activeJobs.length - displayedActiveJobs.length} more active renders →
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-brd px-4 py-5 text-center font-mono text-[0.6rem] uppercase tracking-[0.15em] text-t4">
            Nothing is rendering right now
          </p>
        )}

        {failedJobs.length ? (
          <div className="mt-4 space-y-2">
            <p className="label-mono text-red">Recent render issues</p>
            {failedJobs.map((job) => (
              <div key={job._id} className="rounded-md border border-red/30 bg-red/[0.05] px-3 py-2.5">
                <p className="truncate text-sm text-t1" title={job.prompt}>{job.prompt}</p>
                <p className="mt-1 text-xs text-red">{job.error ?? "The render did not complete. Please try again."}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-5 rounded-lg border border-brd bg-card p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-brd/70 pb-3">
          <div>
            <p className="label-mono">Your finished songs</p>
            <p className="mt-1 text-xs text-t3">Play, move, download, share, view lyrics, or distribute from each song menu.</p>
          </div>
          <span className="label-mono">Latest {finishedTracks.length}</span>
        </div>

        {finishedTracks.length ? (
          <div className="rounded-md border border-brd bg-paper/[0.015] p-1">
            {finishedTracks.map((track, index) => (
              <TrackRow
                key={track._id}
                trackId={track._id}
                trackNum={track.trackNum}
                title={track.title}
                artistSlug={track.artistSlug}
                albumSlug={track.albumSlug}
                duration={track.duration}
                generator={track.generator}
                audioKey={track.audioKey}
                flacKey={track.flacKey}
                coverKey={track.coverKey}
                hearted={hearted.has(track._id)}
                queue={queue}
                index={index}
                size="comfortable"
                genre={track.genre}
                createdAt={track.createdAt}
                lyrics={track.lyrics}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-brd px-4 py-7 text-center font-mono text-[0.6rem] uppercase tracking-[0.15em] text-t4">
            Your first finished song will appear here
          </p>
        )}
      </section>
    </main>
  );
}

function FeedbackNotice({ feedback }: { feedback: Exclude<Feedback, null> }) {
  return (
    <p
      className={
        "rounded-md border px-3 py-2.5 text-sm " +
        (feedback.kind === "ok"
          ? "border-green/30 bg-green/[0.06] text-green"
          : "border-red/30 bg-red/[0.06] text-red")
      }
      role="status"
    >
      {feedback.message}
    </p>
  );
}

function RenderBuffer({ job }: { job: { _id: string; prompt: string; status: string } }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-amber/30 bg-amber/[0.045] px-3 py-3">
      <span aria-label="Rendering" className="h-4 w-4 shrink-0 rounded-full border-2 border-amber/30 border-t-amber animate-spin" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-t1" title={job.prompt}>{job.prompt}</p>
        <p className="mt-1 font-mono text-[0.55rem] uppercase tracking-[0.15em] text-amber">
          {job.status === "pending" ? "Starting Suno render…" : "Suno is rendering your song…"}
        </p>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="label-mono block">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-brd bg-paper/[0.04] p-2.5 text-[0.85rem] text-t1 outline-none transition-colors focus:border-purple/50"
      />
    </label>
  );
}

function SavedLyricsPicker({ onPick }: { onPick: (title: string, lyrics: string) => void }) {
  const saved = useQuery(api.savedLyrics.list, {}) ?? [];
  if (!saved.length) return null;

  return (
    <label className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[0.55rem] uppercase tracking-[0.15em] text-t3">Use saved lyrics</span>
      <select
        defaultValue=""
        onChange={(event) => {
          const id = event.target.value;
          const item = saved.find((entry) => entry._id === id);
          if (item) onPick(item.title, item.lyrics);
          event.target.value = "";
        }}
        className="rounded-md border border-brd bg-paper/[0.04] px-2 py-1 text-[0.75rem] text-t1 outline-none focus:border-purple/50"
      >
        <option value="">— select lyrics —</option>
        {saved.map((entry) => (
          <option key={entry._id} value={entry._id}>
            {entry.title}{entry.genre ? ` · ${entry.genre}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
