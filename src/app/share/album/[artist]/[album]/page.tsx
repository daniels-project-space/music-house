"use client";
import { useQuery } from "convex/react";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../../../convex/_generated/api";
import { useResolvedUrls, useUrlCache } from "@/components/url-cache-provider";

type SharedAlbumProps = { params: Promise<{ artist: string; album: string }> };

export default function ShareAlbumPage({ params }: SharedAlbumProps) {
  // Note: generateMetadata can't be used here because page is "use client".
  // Title is set imperatively below via document.title once the album loads.
  const { artist, album } = use(params);
  const albumRow = useQuery(api.albums.getOne, { artistSlug: artist, slug: album });
  const tracks = useQuery(api.tracks.list, { artistSlug: artist, albumSlug: album });
  const artistRow = useQuery(api.artists.getBySlug, { slug: artist });

  const allKeys = useMemo(() => {
    const k: string[] = [];
    if (albumRow?.coverKey) k.push(albumRow.coverKey);
    if (tracks) for (const t of tracks) k.push(t.audioKey);
    return k;
  }, [albumRow, tracks]);
  useResolvedUrls(allKeys);
  const { get, ensure } = useUrlCache();

  const cover = albumRow?.coverKey ? get(albumRow.coverKey) : undefined;
  const sorted = useMemo(
    () =>
      (tracks ?? [])
        .filter((t) => !t.archivedAt)
        .sort((a, b) => (a.trackNum ?? 99) - (b.trackNum ?? 99)),
    [tracks],
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setPos(a.currentTime);
    const onLoaded = () => setDur(a.duration || 0);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onLoaded);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onLoaded);
    };
  }, []);

  const playTrack = async (t: { _id: string; audioKey: string }) => {
    const a = audioRef.current;
    if (!a) return;
    if (activeId === t._id) {
      if (a.paused) a.play().catch(() => {});
      else a.pause();
      return;
    }
    const url = get(t.audioKey) ?? (await ensure([t.audioKey]))[t.audioKey];
    if (!url) return;
    a.src = url;
    a.play().catch(() => {});
    setActiveId(t._id);
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  const activeTrack = sorted.find((t) => t._id === activeId);

  // Set document title to the album/artist (overrides "Music House" from root)
  useEffect(() => {
    if (albumRow && typeof document !== "undefined") {
      const artistName = artistRow?.name ?? albumRow.artistSlug;
      document.title = `${albumRow.name} · ${artistName}`;
    }
  }, [albumRow, artistRow]);

  if (!albumRow || !tracks) {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-paper-faint">loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-28 sm:pb-32">
      {/* Hero */}
      <div className="relative">
        <div
          className="absolute inset-0 -z-10 opacity-50 blur-3xl"
          style={cover ? { backgroundImage: `url(${cover})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-bg2/60 via-bg/80 to-bg" />
        <div className="px-4 sm:px-10 lg:px-16 pt-8 sm:pt-16 pb-6 sm:pb-10 max-w-6xl mx-auto flex flex-col sm:flex-row gap-5 sm:gap-8 items-center sm:items-end">
          <div
            className="w-44 h-44 sm:w-56 sm:h-56 lg:w-64 lg:h-64 rounded-lg overflow-hidden ring-1 ring-paper/10 bg-paper/[0.04] shrink-0"
            style={{ boxShadow: "0 24px 60px rgba(0,0,0,0.45)" }}
          >
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt={albumRow.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full grid place-items-center text-5xl text-t4">♪</div>
            )}
          </div>
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.2em] text-paper-faint mb-2">Album</p>
            <h1 className="font-display text-2xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-paper leading-tight mb-2 sm:mb-3">
              {albumRow.name}
            </h1>
            <p className="font-display text-[0.95rem] sm:text-[1rem] text-paper-dim mb-1">
              {artistRow?.name ?? albumRow.artistSlug}
            </p>
            <p className="font-mono text-[0.55rem] sm:text-[0.6rem] uppercase tracking-[0.18em] text-paper-faint">
              {sorted.length} tracks
              {albumRow.genre ? ` · ${albumRow.genre}` : ""}
            </p>
            {albumRow.description ? (
              <p className="font-display text-[0.78rem] sm:text-[0.85rem] text-paper-dim mt-3 sm:mt-4 max-w-xl">{albumRow.description}</p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Tracklist */}
      <div className="px-3 sm:px-10 lg:px-16 max-w-4xl mx-auto mt-2">
        <ul className="rounded-md border border-brd/40 bg-card/30 backdrop-blur p-2 space-y-0.5">
          {sorted.map((t, i) => {
            const isActive = activeId === t._id;
            const dura = t.duration;
            return (
              <li
                key={t._id}
                className={
                  "flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 rounded transition-colors " +
                  (isActive ? "bg-purple/[0.08]" : "hover:bg-paper/[0.03]")
                }
              >
                <span className="hidden sm:inline w-6 font-mono text-[0.6rem] text-paper-faint text-right tabular-nums">
                  {t.trackNum ?? i + 1}
                </span>
                <button
                  onClick={() => playTrack(t)}
                  className={
                    "w-9 h-9 sm:w-8 sm:h-8 shrink-0 rounded-full grid place-items-center transition-all " +
                    (isActive
                      ? "bg-purple text-paper"
                      : "bg-paper/[0.06] text-paper hover:bg-purple/30")
                  }
                  aria-label={isActive && playing ? "Pause" : "Play"}
                >
                  {isActive && playing ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-[0.85rem] sm:text-[0.92rem] text-paper truncate leading-tight">{t.title}</div>
                  {t.genre ? (
                    <div className="font-mono text-[0.5rem] sm:text-[0.55rem] uppercase tracking-[0.14em] text-paper-faint mt-0.5 truncate">{t.genre}</div>
                  ) : null}
                </div>
                <span className="font-mono text-[0.65rem] sm:text-[0.7rem] text-paper-faint tabular-nums shrink-0">
                  {dura ? fmt(dura) : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Inline player at bottom (only when something is playing) */}
      {activeTrack ? (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-2xl"
          style={{
            background: "linear-gradient(180deg, rgba(12,20,36,0.92), rgba(12,20,36,0.98))",
            borderTop: "1px solid var(--color-brd)",
            boxShadow: "0 -16px 40px rgba(0,0,0,0.5)",
          }}
        >
          <div className="px-3 sm:px-10 lg:px-16 max-w-4xl mx-auto py-3 flex items-center gap-3 sm:gap-4">
            <button
              onClick={() => playTrack(activeTrack)}
              className="w-10 h-10 shrink-0 rounded-full grid place-items-center text-paper"
              style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)" }}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="font-display text-[0.8rem] sm:text-[0.85rem] text-paper truncate leading-tight">{activeTrack.title}</div>
              <div className="font-mono text-[0.5rem] sm:text-[0.55rem] uppercase tracking-[0.14em] text-paper-faint truncate">
                {artistRow?.name ?? albumRow.artistSlug}
              </div>
            </div>
            <span className="font-mono text-[0.65rem] text-paper-faint tabular-nums shrink-0 hidden sm:block">
              {fmt(pos)} / {fmt(dur)}
            </span>
            <div
              className="hidden sm:block flex-1 max-w-md h-[3px] bg-paper/[0.06] rounded cursor-pointer relative"
              onClick={(e) => {
                const a = audioRef.current;
                if (!a || !dur) return;
                const r = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientX - r.left) / r.width;
                a.currentTime = Math.max(0, Math.min(dur, ratio * dur));
              }}
            >
              <div
                className="absolute top-0 left-0 h-full"
                style={{
                  width: `${dur ? (pos / dur) * 100 : 0}%`,
                  background: "linear-gradient(90deg, #ec4899, #8b5cf6)",
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      <audio ref={audioRef} className="hidden" />
    </main>
  );
}
