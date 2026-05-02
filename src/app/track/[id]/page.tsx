"use client";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { use, useEffect, useState } from "react";
import { usePlayer } from "@/components/player-context";

export default function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const trackId = id as Id<"tracks">;
  const track = useQuery(api.tracks.get, { id: trackId });
  const setNotes = useMutation(api.tracks.setNotes);
  const setRating = useMutation(api.tracks.setRating);
  const toggleHeart = useMutation(api.hearts.toggle);
  const isHearted = useQuery(api.hearts.isHearted, { trackId });
  const { play } = usePlayer();
  const [audioUrl, setAudioUrl] = useState("");
  const [notesDraft, setNotesDraft] = useState("");

  useEffect(() => {
    if (!track) return;
    fetch(`/api/audio?key=${encodeURIComponent(track.audioKey)}`).then((r) => r.json()).then((j) => setAudioUrl(j.url));
    setNotesDraft(track.notes ?? "");
  }, [track]);

  if (!track) return <main className="max-w-[1440px] mx-auto px-8 lg:px-14 py-12 text-paper-dim">loading...</main>;

  return (
    <main className="max-w-[1440px] mx-auto px-8 lg:px-14 py-12 grid grid-cols-1 md:grid-cols-3 gap-12">
      <div className="md:col-span-2">
        <a href={track.albumSlug ? `/library/${track.artistSlug}/${track.albumSlug}` : `/library/${track.artistSlug}`} className="font-mono text-paper-dim text-sm hover:text-paper">← back</a>
        <h1 className="font-display text-4xl text-paper mt-2">{track.title}</h1>
        <p className="text-paper-dim text-sm mt-2 font-mono">
          {track.artistSlug}{track.albumSlug ? " · " + track.albumSlug : ""} · {track.generator} · {Math.round((track.duration ?? 0) / 60)}m
        </p>

        <div className="mt-6 flex gap-2">
          <button
            disabled={!audioUrl}
            onClick={() => audioUrl && play({ id: track._id, title: track.title, artist: track.artistSlug, album: track.albumSlug ?? undefined, audioUrl })}
            className="px-4 py-2 rounded bg-amber/20 text-amber border border-amber/40 hover:bg-amber/30 disabled:opacity-30"
          >
            ▶ Play
          </button>
          <button onClick={() => toggleHeart({ trackId })} className={`px-4 py-2 rounded border ${isHearted ? "border-amber/60 bg-amber/10 text-amber" : "border-rule-soft/60 text-paper-dim"}`}>
            ♥ {isHearted ? "Hearted" : "Heart"}
          </button>
        </div>

        <h2 className="mt-12 font-display text-xl text-paper">Lyrics</h2>
        <div className="mt-4 space-y-1">
          {(track.lyrics ?? []).map((l, i) => (
            <div key={i} className={`text-sm ${l.isSection ? "text-amber font-mono uppercase tracking-wider mt-4" : "text-paper"}`}>
              {!l.isSection && <span className="text-paper-dim font-mono text-xs mr-3">{Math.floor(l.start / 60)}:{String(Math.floor(l.start % 60)).padStart(2, "0")}</span>}
              {l.text}
            </div>
          ))}
          {(!track.lyrics || track.lyrics.length === 0) && <p className="text-paper-dim text-sm">No lyrics yet.</p>}
        </div>
      </div>

      <aside className="space-y-6">
        <div>
          <div className="font-mono text-paper-dim text-xs uppercase tracking-wider">Rating</div>
          <div className="mt-2 flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating({ id: trackId, rating: n })}
                      className={`w-8 h-8 rounded border ${(track.rating ?? 0) >= n ? "bg-amber/30 border-amber" : "border-rule-soft/60 text-paper-dim"}`}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="font-mono text-paper-dim text-xs uppercase tracking-wider">Notes</div>
          <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)}
                    onBlur={() => setNotes({ id: trackId, notes: notesDraft })}
                    className="mt-2 w-full bg-paper/5 border border-rule-soft/60 rounded p-3 text-paper text-sm min-h-32" />
        </div>
        {track.clapScore !== undefined && (
          <div>
            <div className="font-mono text-paper-dim text-xs uppercase tracking-wider">CLAP</div>
            <div className="mt-2 text-paper">{(track.clapScore * 100).toFixed(1)}% — {track.clapBestMatch ?? ""}</div>
          </div>
        )}
      </aside>
    </main>
  );
}
