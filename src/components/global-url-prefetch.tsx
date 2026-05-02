"use client";

import { useQuery } from "convex/react";
import { useEffect, useMemo } from "react";
import { api } from "../../convex/_generated/api";
import { useUrlCache } from "./url-cache-provider";

// Mounts at app shell. As soon as albums + tracks load, presigns every cover
// + audio key in one batch so navigation never re-fetches.
export function GlobalUrlPrefetch() {
  const albums = useQuery(api.albums.list, {});
  const tracks = useQuery(api.tracks.list, {});
  const { ensure } = useUrlCache();

  const keys = useMemo(() => {
    const out: string[] = [];
    if (albums) for (const a of albums) if (a.coverKey) out.push(a.coverKey);
    if (tracks) {
      // limit audio keys to recent 200 tracks to avoid massive prefetch
      const recent = [...tracks].sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0)).slice(0, 200);
      for (const t of recent) if (t.audioKey) out.push(t.audioKey);
    }
    return out;
  }, [albums, tracks]);

  useEffect(() => {
    if (!keys.length) return;
    // Fire-and-forget; cache provider dedupes inflight + persists to localStorage
    ensure(keys).catch(() => {});
  }, [keys, ensure]);

  return null;
}
