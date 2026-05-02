"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayer } from "./player-context";

type Line = { text: string; start: number; isSection: boolean };

export function KaraokeLyrics({ title, lyrics, trackId }: { title: string; lyrics: Line[]; trackId: string }) {
  const { current } = usePlayer();
  const [time, setTime] = useState(0);
  const innerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (current?.id !== trackId) return;
    const audio = document.querySelector("audio") as HTMLAudioElement | null;
    if (!audio) return;
    const onUpdate = () => setTime(audio.currentTime);
    audio.addEventListener("timeupdate", onUpdate);
    return () => audio.removeEventListener("timeupdate", onUpdate);
  }, [current, trackId]);

  if (!lyrics?.length) {
    return (
      <div className="grid place-items-center min-h-[340px]">
        <div className="text-center max-w-[200px]">
          <p className="font-display text-[0.95rem] text-t1 mb-1">{title}</p>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-t4 mt-3">No lyrics yet</p>
        </div>
      </div>
    );
  }

  const isLive = current?.id === trackId;
  let activeIdx = 0;
  if (isLive) {
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].start <= time) activeIdx = i;
    }
  }

  const lineClass = (i: number, isSection: boolean) => {
    if (isSection) return "lyric-line lyric-section";
    const d = Math.abs(i - activeIdx);
    if (!isLive) return "lyric-line lyric-near2";
    if (d === 0) return "lyric-line lyric-active";
    if (d === 1) return "lyric-line lyric-near1";
    if (d === 2) return "lyric-line lyric-near2";
    return "lyric-line lyric-far";
  };

  return (
    <div>
      <p className="font-display text-[0.92rem] text-t1 truncate mb-1">{title}</p>
      <p className="label-mono mb-4">
        {isLive ? `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}` : "—"}
      </p>
      <div
        className="relative h-[340px] overflow-hidden"
        style={{
          maskImage: "linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%)",
        }}
      >
        <div
          ref={innerRef}
          className="transition-transform duration-500 ease-out"
          style={{ transform: `translateY(calc(50% - ${activeIdx * 28}px))` }}
        >
          {lyrics.map((l, i) => (
            <div key={i} className={lineClass(i, l.isSection)} style={{ minHeight: 24, padding: "2px 4px" }}>
              {l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
