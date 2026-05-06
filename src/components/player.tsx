"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayer } from "./player-context";

export function Player() {
  const { current, next, prev } = usePlayer();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(0.85);
  const [shuffle, setShuffle] = useState(false);

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
      {current && (
        <div
          className="fixed bottom-0 left-0 lg:left-[240px] right-0 z-40 backdrop-blur-2xl"
          style={{
            background: "linear-gradient(180deg, rgba(10,12,18,0.94), rgba(5,6,8,0.98))",
            borderTop: "1px solid var(--color-brd)",
            boxShadow: "0 -16px 40px rgba(0,0,0,0.5)",
          }}
        >
          <div className="px-5 sm:px-6 lg:px-8 py-3 flex items-center gap-4 sm:gap-5">
            {/* Vinyl art with cover label */}
            <div className="relative w-14 h-14 shrink-0">
              <div className={"absolute inset-0 rounded-full vinyl " + (playing ? "animate-vinyl animate-vinyl-glow" : "")} />
              {current.coverUrl ? (
                <div className={"absolute inset-[14px] rounded-full overflow-hidden ring-1 ring-paper/15 " + (playing ? "animate-vinyl" : "")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={current.coverUrl} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="absolute inset-[14px] rounded-full bg-gradient-to-br from-pink/40 to-purple/40 ring-1 ring-paper/15" />
              )}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-paper/70 z-10" />
            </div>

            {/* Track info — fixed width */}
            <div className="w-[160px] sm:w-[200px] shrink-0 min-w-0">
              <div className="text-[0.78rem] text-paper truncate font-display font-semibold leading-tight">{current.title}</div>
              <div className="font-mono text-[0.55rem] text-paper-faint truncate uppercase tracking-[0.14em] mt-0.5">
                {current.artist}
                {current.album ? <span className="text-paper-faint/60"> · </span> : null}
                {current.album}
              </div>
            </div>

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
