"use client";
import { createContext, useContext, useState, ReactNode, useCallback } from "react";

export type PlayerTrack = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  audioUrl: string;
  coverUrl?: string;
};

type Ctx = {
  current: PlayerTrack | null;
  queue: PlayerTrack[];
  play: (track: PlayerTrack, queue?: PlayerTrack[]) => void;
  next: () => void;
  prev: () => void;
};

const PlayerCtx = createContext<Ctx | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);

  const play = useCallback((track: PlayerTrack, q?: PlayerTrack[]) => {
    setCurrent(track);
    if (q) setQueue(q);
  }, []);

  const next = useCallback(() => {
    if (!current || queue.length === 0) return;
    const idx = queue.findIndex((t) => t.id === current.id);
    if (idx >= 0 && idx < queue.length - 1) setCurrent(queue[idx + 1]);
  }, [current, queue]);

  const prev = useCallback(() => {
    if (!current || queue.length === 0) return;
    const idx = queue.findIndex((t) => t.id === current.id);
    if (idx > 0) setCurrent(queue[idx - 1]);
  }, [current, queue]);

  return <PlayerCtx.Provider value={{ current, queue, play, next, prev }}>{children}</PlayerCtx.Provider>;
}

export function usePlayer() {
  const c = useContext(PlayerCtx);
  if (!c) throw new Error("usePlayer outside PlayerProvider");
  return c;
}
