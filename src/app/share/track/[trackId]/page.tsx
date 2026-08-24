"use client";

import { use, useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../../../../convex/_generated/api";
import { useResolvedUrls, useUrlCache } from "@/components/url-cache-provider";

type SharedTrackProps = { params: Promise<{ trackId: string }> };

export default function ShareTrackPage({ params }: SharedTrackProps) {
  const { trackId } = use(params);
  const track = useQuery(api.tracks.get, { id: trackId as Id<"tracks"> });
  const artist = useQuery(api.artists.getBySlug, { slug: track?.artistSlug ?? "" });
  const { get, ensure } = useUrlCache();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const coverUrls = useResolvedUrls(track?.coverKey ? [track.coverKey] : []);
  const coverUrl = track?.coverKey ? coverUrls[track.coverKey] : undefined;

  useEffect(() => {
    if (!track) return;
    document.title = `${track.title} · ${artist?.name ?? track.artistSlug}`;
  }, [artist?.name, track]);

  const play = async () => {
    if (!track || track.archivedAt) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.src && !audio.paused) {
      audio.pause();
      return;
    }
    const url = get(track.audioKey) ?? (await ensure([track.audioKey]))[track.audioKey];
    if (!url) return;
    audio.src = url;
    await audio.play().catch(() => {});
  };

  if (track === undefined) {
    return <ShareLoading label="Loading track…" />;
  }
  if (!track || track.archivedAt) {
    return <ShareLoading label="This track is no longer available" />;
  }

  return (
    <main className="min-h-screen grid place-items-center px-4 py-10">
      <section className="w-full max-w-lg overflow-hidden rounded-xl border border-brd bg-card shadow-2xl">
        <div
          className="h-48 sm:h-60 bg-gradient-to-br from-pink/30 via-purple/25 to-bg relative"
          style={coverUrl ? { backgroundImage: `url(${coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-bg/90 to-transparent" />
          <div className="absolute inset-x-5 bottom-5">
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.2em] text-paper-faint">Music House · shared track</p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-paper mt-1 leading-tight">{track.title}</h1>
            <p className="font-display text-[0.9rem] text-paper-dim mt-1">{artist?.name ?? track.artistSlug}</p>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-5">
            <span className="font-mono text-[0.55rem] uppercase tracking-[0.16em] text-paper-faint">
              {track.genre ?? "AI music"} · {track.generator}
            </span>
            <span className="font-mono text-[0.55rem] uppercase tracking-[0.16em] text-green">
              {track.audioKey.endsWith(".wav") || track.flacKey ? "Lossless master" : "Master upgrade pending"}
            </span>
          </div>

          <button
            type="button"
            onClick={play}
            className="w-full rounded-md py-3 font-display font-semibold text-[0.95rem] text-white transition-transform hover:-translate-y-0.5"
            style={{ background: "linear-gradient(90deg, #ec4899, #8b5cf6)", boxShadow: "0 8px 24px rgba(236,72,153,0.18)" }}
          >
            {playing ? "Pause" : "Play track"}
          </button>
          <audio
            ref={audioRef}
            className="hidden"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        </div>
      </section>
    </main>
  );
}

function ShareLoading({ label }: { label: string }) {
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-paper-faint">{label}</p>
    </main>
  );
}
