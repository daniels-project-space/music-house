"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayer } from "./player-context";

export function Player() {
  const { current, next, prev } = usePlayer();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    if (!audioRef.current || !current) return;
    audioRef.current.src = current.audioUrl;
    audioRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
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
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    a.currentTime = Math.max(0, Math.min(dur, ratio * dur));
  };

  if (!current) return <audio ref={audioRef} className="hidden" />;

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl"
      style={{
        background: "linear-gradient(180deg, rgba(10,12,18,0.85), rgba(10,12,18,0.97))",
        borderTop: "1px solid var(--color-brd)",
      }}
    >
      {/* progress bar — full width across the top of player */}
      <div
        onClick={seek}
        className="h-[3px] cursor-pointer relative bg-paper/[0.04] hover:bg-paper/[0.08] transition-colors"
      >
        <div
          className="absolute top-0 left-0 h-full"
          style={{
            width: dur ? `${(pos / dur) * 100}%` : "0%",
            background: "linear-gradient(90deg, #ec4899, #8b5cf6)",
          }}
        />
      </div>

      <div className="max-w-[1600px] mx-auto px-8 lg:px-12 py-3 flex items-center gap-6">
        {/* Vinyl */}
        <div className="relative w-12 h-12 shrink-0">
          <div className={"absolute inset-0 rounded-full vinyl " + (playing ? "animate-vinyl" : "")} />
          {current.coverUrl ? (
            <div
              className={"absolute inset-[14px] rounded-full overflow-hidden border border-paper/10 " + (playing ? "animate-vinyl" : "")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current.coverUrl} alt="" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="absolute inset-[14px] rounded-full bg-gradient-to-br from-pink/40 to-purple/40" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[0.84rem] text-t1 truncate font-display font-medium">{current.title}</div>
          <div className="font-mono text-[0.6rem] text-t3 truncate">
            {current.artist}
            {current.album ? " · " + current.album : ""}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button onClick={prev} className="w-8 h-8 grid place-items-center text-t3 hover:text-t1 transition-colors" aria-label="Previous">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" transform="scale(-1,1) translate(-24,0)"/></svg>
          </button>
          <button onClick={togglePlay} className="w-10 h-10 grid place-items-center rounded-full bg-paper/5 hover:bg-paper/10 transition-colors text-t1" aria-label="Play/Pause">
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <button onClick={next} className="w-8 h-8 grid place-items-center text-t3 hover:text-t1 transition-colors" aria-label="Next">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
        </div>

        <div className="font-mono text-[0.6rem] text-t3 tabular-nums shrink-0">
          {fmt(pos)} <span className="text-t4 mx-1">/</span> {fmt(dur)}
        </div>

        <audio ref={audioRef} onEnded={next} className="hidden" />
      </div>
    </div>
  );
}
