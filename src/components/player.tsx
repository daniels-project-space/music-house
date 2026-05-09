"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePlayer } from "./player-context";

export function Player() {
  const { current, next, prev } = usePlayer();
  const pathname = usePathname() ?? "";
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(0.85);
  const [shuffle, setShuffle] = useState(false);
  const isPublicRoute = pathname.startsWith("/share");

  useEffect(() => {
    if (!audioRef.current || !current) return;
    if (audioRef.current.src !== current.audioUrl) {
      audioRef.current.src = current.audioUrl;
    }
    audioRef.current.play().catch(() => setPlaying(false));
  }, [current]);

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
    a.volume = vol;
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onLoaded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = vol;
  }, [vol]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play();
    else a.pause();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - r.left) / r.width;
    a.currentTime = Math.max(0, Math.min(dur, ratio * dur));
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const pct = dur ? (pos / dur) * 100 : 0;

  return (
    <>
      <audio ref={audioRef} onEnded={next} className="hidden" />
      {current && !isPublicRoute && (
        <div
          className="fixed bottom-0 left-0 lg:left-[220px] right-0 z-40 backdrop-blur-2xl"
          style={{
            background: "linear-gradient(180deg, rgba(10,12,18,0.94), rgba(5,6,8,0.98))",
            borderTop: "1px solid var(--color-brd)",
            boxShadow: "0 -16px 40px rgba(0,0,0,0.5)",
          }}
        >
          <div className="px-5 sm:px-6 lg:px-8 py-3 flex items-center gap-4 sm:gap-5">
            {/* Album sleeve + slim vinyl peeking out to the right */}
            <Link
              href={`/library/${current.artist}/${current.album ?? "_singles"}#track-${current.id}`}
              aria-label={`Jump to ${current.title}`}
              className="relative w-[80px] h-14 shrink-0 group"
            >
              {/* Slim vinyl behind, ~half visible peeking out right of cover */}
              <div
                className={
                  "absolute top-1 right-0 w-12 h-12 rounded-full vinyl z-0 " +
                  (playing ? "animate-vinyl-playing" : "")
                }
              >
                <div className="absolute inset-[42%] rounded-full bg-paper/80" />
              </div>
              {/* Square cover sleeve in front */}
              <div
                className="absolute top-0 left-0 w-14 h-14 rounded-md overflow-hidden ring-1 ring-paper/10 group-hover:ring-purple/40 transition-all bg-paper/[0.04] z-10"
                style={{ boxShadow: "2px 2px 10px rgba(0,0,0,0.55)" }}
              >
                {current.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={current.coverUrl}
                    alt={current.title}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center bg-gradient-to-br from-pink/40 to-purple/40 text-paper text-base">♪</div>
                )}
              </div>
            </Link>

            {/* Track info — fixed width, click to jump to track in album */}
            <Link
              href={`/library/${current.artist}/${current.album ?? "_singles"}#track-${current.id}`}
              className="w-[160px] sm:w-[200px] shrink-0 min-w-0 hover:opacity-80 transition-opacity"
            >
              <div className="text-[0.78rem] text-paper truncate font-display font-semibold leading-tight">{current.title}</div>
              <div className="font-mono text-[0.55rem] text-paper-faint truncate uppercase tracking-[0.14em] mt-0.5">
                {current.artist}
                {current.album ? <span className="text-paper-faint/60"> · </span> : null}
                {current.album}
              </div>
            </Link>

            {/* Now-playing bars indicator */}
            {playing && (
              <div className="hidden lg:block np-bars shrink-0" aria-hidden>
                <span /><span /><span /><span />
              </div>
            )}

            {/* Controls */}
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={prev} className="w-8 h-8 grid place-items-center text-paper-dim hover:text-paper transition-colors" aria-label="Previous">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" transform="scale(-1,1) translate(-24,0)" /></svg>
              </button>
              <button
                onClick={togglePlay}
                className="w-9 h-9 grid place-items-center rounded-full text-paper transition-all hover:scale-105"
                style={{
                  background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
                  boxShadow: "0 0 14px rgba(236,72,153,0.28)",
                }}
                aria-label="Play/Pause"
              >
                {playing ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                )}
              </button>
              <button onClick={next} className="w-8 h-8 grid place-items-center text-paper-dim hover:text-paper transition-colors" aria-label="Next">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
              </button>
            </div>

            {/* Scrubber + time */}
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <span className="font-mono text-[0.55rem] text-paper-dim tabular-nums shrink-0 w-9 text-right">{fmt(pos)}</span>
              <div onClick={seek} className="flex-1 h-[3px] bg-paper/[0.06] rounded cursor-pointer relative group/scr">
                <div
                  className="absolute top-0 left-0 h-full transition-all duration-100"
                  style={{ width: `${pct}%`, background: "linear-gradient(90deg, #ec4899, #8b5cf6)" }}
                />
                <div
                  className="absolute -top-1 w-2.5 h-2.5 rounded-full opacity-0 group-hover/scr:opacity-100 transition-opacity"
                  style={{ left: `calc(${pct}% - 5px)`, background: "#ec4899", boxShadow: "0 0 8px rgba(236,72,153,0.6)" }}
                />
              </div>
              <span className="font-mono text-[0.55rem] text-paper-faint tabular-nums shrink-0 w-9">{fmt(dur)}</span>
            </div>

            {/* Volume + shuffle — desktop only */}
            <div className="hidden lg:flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShuffle((v) => !v)}
                className={"font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2 py-1 rounded border transition-colors " + (shuffle ? "border-purple text-purple" : "border-brd text-paper-faint hover:text-paper-dim")}
                aria-label="Shuffle"
              >
                ⤮
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={vol}
                onChange={(e) => setVol(parseFloat(e.target.value))}
                className="w-16 h-[3px] accent-purple"
                aria-label="Volume"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
