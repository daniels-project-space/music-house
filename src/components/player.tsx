"use client";
import { useEffect, useRef } from "react";
import { usePlayer } from "./player-context";

export function Player() {
  const { current, next, prev } = usePlayer();
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!audioRef.current || !current) return;
    audioRef.current.src = current.audioUrl;
    audioRef.current.play().catch(() => {});
  }, [current]);

  if (!current) return null;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-rule-soft/60 bg-ink/95 backdrop-blur">
      <div className="max-w-[1440px] mx-auto px-8 py-3 flex items-center gap-6">
        {current.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.coverUrl} alt="" className="w-12 h-12 rounded object-cover" />
        ) : (
          <div className="w-12 h-12 rounded bg-paper/10" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-paper text-sm truncate">{current.title}</div>
          <div className="text-paper-dim text-xs truncate font-mono">{current.artist ?? ""}{current.album ? " · " + current.album : ""}</div>
        </div>
        <button onClick={prev} className="text-paper-dim hover:text-paper text-sm font-mono">⏮</button>
        <button onClick={next} className="text-paper-dim hover:text-paper text-sm font-mono">⏭</button>
        <audio ref={audioRef} controls className="flex-1 max-w-md" onEnded={next} />
      </div>
    </div>
  );
}
