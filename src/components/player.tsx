"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayer } from "./player-context";

export function Player() {
  const { current, next, prev } = usePlayer();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);

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
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onLoaded);
    };
  }, []);

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

  // ALWAYS render the audio element so it persists; render UI only when current
  return (
    <>
      <audio ref={audioRef} onEnded={next} className="hidden" />
      {current && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-2xl"
          style={{
            background: "linear-gradient(180deg, rgba(10,12,18,0.86), rgba(10,12,18,0.97))",
            borderTop: "1px solid var(--color-brd)",
            boxShadow: "0 -16px 40px rgba(0,0,0,0.4)",
          }}
        >
          <div
            onClick={seek}
            className="h-[3px] cursor-pointer relative bg-paper/[0.04] hover:bg-paper/[0.08] transition-colors group/pb"
          >
            <div
              className="absolute top-0 left-0 h-full transition-all duration-100"
              style={{
                width: dur ? `${(pos / dur) * 100}%` : "0%",
                background: "linear-gradient(90deg, #ec4899, #8b5cf6, #06b6d4)",
              }}
            />
            <div
              className="absolute -top-[5px] w-3 h-3 rounded-full opacity-0 group-hover/pb:opacity-100 transition-opacity"
              style={{
                left: dur ? `calc(${(pos / dur) * 100}% - 6px)` : "0%",
                background: "#ec4899",
                boxShadow: "0 0 12px rgba(236,72,153,0.6)",
              }}
            />
          </div>

          <div className="max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-14 py-3 flex items-center gap-4 sm:gap-6">
            <div className="relative w-12 h-12 sm:w-14 sm:h-14 shrink-0">
              <div className={"absolute inset-0 rounded-full vinyl " + (playing ? "animate-vinyl" : "")} />
              {current.coverUrl ? (
                <div className={"absolute inset-[14px] rounded-full overflow-hidden ring-1 ring-paper/15 " + (playing ? "animate-vinyl" : "")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={current.coverUrl} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="absolute inset-[14px] rounded-full bg-gradient-to-br from-pink/40 to-purple/40 ring-1 ring-paper/15" />
              )}
              <div className="absolute inset-0 rounded-full ring-1 ring-paper/[0.04]" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-[0.88rem] text-paper truncate font-display font-medium">{current.title}</div>
              <div className="font-mono text-[0.6rem] text-t3 truncate uppercase tracking-[0.14em] mt-0.5">
                {current.artist}
                {current.album ? <span className="text-t4"> · </span> : null}
                {current.album}
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <button onClick={prev} className="w-9 h-9 grid place-items-center text-t3 hover:text-paper transition-colors" aria-label="Previous">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" transform="scale(-1,1) translate(-24,0)"/></svg>
              </button>
              <button
                onClick={togglePlay}
                className="w-11 h-11 grid place-items-center rounded-full text-paper transition-all hover:scale-105"
                style={{ background: "linear-gradient(135deg, rgba(236,72,153,0.18), rgba(139,92,246,0.18))", border: "1px solid rgba(236,72,153,0.3)" }}
                aria-label="Play/Pause"
              >
                {playing ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                )}
              </button>
              <button onClick={next} className="w-9 h-9 grid place-items-center text-t3 hover:text-paper transition-colors" aria-label="Next">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
              </button>
            </div>

            <div className="hidden sm:block font-mono text-[0.62rem] text-t3 tabular-nums shrink-0 text-right min-w-[68px]">
              <span className="text-paper">{fmt(pos)}</span>
              <span className="text-t4 mx-1">/</span>
              {fmt(dur)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
