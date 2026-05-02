"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";

type CacheEntry = { url: string; expiresAt: number };
type Ctx = {
  get: (key: string) => string | undefined;
  ensure: (keys: string[]) => Promise<Record<string, string>>;
};

const URLCacheCtx = createContext<Ctx | null>(null);
const TTL_MS = 50 * 60 * 1000; // 50 min — presigned URLs valid 60 min
const STORAGE_KEY = "mh:url-cache:v1";

export function UrlCacheProvider({ children }: { children: ReactNode }) {
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const inflightRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const [, force] = useState(0);

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: Record<string, CacheEntry> = JSON.parse(raw);
      const now = Date.now();
      for (const [k, v] of Object.entries(parsed)) {
        if (v.expiresAt > now) cacheRef.current.set(k, v);
      }
      force((n) => n + 1);
    } catch {}
  }, []);

  // Persist to localStorage on cache change (debounced via timeout)
  const persist = useCallback(() => {
    try {
      const obj: Record<string, CacheEntry> = {};
      for (const [k, v] of cacheRef.current.entries()) obj[k] = v;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {}
  }, []);

  const get = useCallback((key: string) => {
    const entry = cacheRef.current.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      cacheRef.current.delete(key);
      return undefined;
    }
    return entry.url;
  }, []);

  const ensure = useCallback(
    async (keys: string[]): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      const missing: string[] = [];
      const now = Date.now();
      for (const k of keys) {
        if (!k) continue;
        const e = cacheRef.current.get(k);
        if (e && e.expiresAt > now) {
          out[k] = e.url;
          continue;
        }
        // dedupe inflight
        const inflight = inflightRef.current.get(k);
        if (inflight) {
          const v = await inflight;
          if (v) out[k] = v;
          continue;
        }
        missing.push(k);
      }
      if (missing.length === 0) return out;

      const job = (async () => {
        const r = await fetch("/api/presign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ keys: missing }),
        });
        const j = (await r.json().catch(() => ({}))) as { urls?: Record<string, string> };
        const expiresAt = Date.now() + TTL_MS;
        for (const k of missing) {
          const url = j.urls?.[k];
          if (url) {
            cacheRef.current.set(k, { url, expiresAt });
            out[k] = url;
          }
        }
        persist();
        force((n) => n + 1);
        return out;
      })();

      const promiseByKey = job.then((res) => res);
      for (const k of missing) {
        inflightRef.current.set(k, promiseByKey.then((m) => m[k] ?? null));
      }
      try {
        return await job;
      } finally {
        for (const k of missing) inflightRef.current.delete(k);
      }
    },
    [persist],
  );

  const ctx = useMemo(() => ({ get, ensure }), [get, ensure]);
  return <URLCacheCtx.Provider value={ctx}>{children}</URLCacheCtx.Provider>;
}

export function useUrlCache(): Ctx {
  const c = useContext(URLCacheCtx);
  if (!c) throw new Error("useUrlCache outside UrlCacheProvider");
  return c;
}

// Convenience hook: ensure a list of keys is cached and re-render when ready.
export function useResolvedUrls(keys: string[]): Record<string, string> {
  const { ensure } = useUrlCache();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const sig = keys.filter(Boolean).sort().join("|");
  useEffect(() => {
    let cancelled = false;
    if (!keys.length) return;
    ensure(keys).then((m) => {
      if (!cancelled) setUrls(m);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return urls;
}
