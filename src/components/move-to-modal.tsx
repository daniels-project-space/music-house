"use client";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useUrlCache, useResolvedUrls } from "./url-cache-provider";

type MoveToModalProps = {
  open: boolean;
  onClose: () => void;
  // Track-mode: when set, an album select moves the track. Otherwise creates album only.
  trackId?: Id<"tracks">;
  artistSlug: string;
  currentAlbumSlug?: string;
};

type View = "select" | "new";

export function MoveToModal({ open, onClose, trackId, artistSlug, currentAlbumSlug }: MoveToModalProps) {
  const [view, setView] = useState<View>("select");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-album form state
  const [newName, setNewName] = useState("");
  const [newStyle, setNewStyle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const move = useMutation(api.tracks.move);
  const albums = useQuery(api.albums.list, open ? { artistSlug } : "skip") ?? [];
  const coverKeys = useMemo(
    () => albums.map((a) => a.coverKey).filter((k): k is string => !!k),
    [albums],
  );
  useResolvedUrls(coverKeys);
  const { get } = useUrlCache();

  useEffect(() => {
    if (!open) {
      // Reset on close
      setView("select");
      setBusy(false);
      setError(null);
      setNewName("");
      setNewStyle("");
      setNewDescription("");
    }
  }, [open]);

  if (!open) return null;

  const moveToAlbum = async (targetAlbumSlug: string | undefined) => {
    if (!trackId) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await move({ id: trackId, targetArtistSlug: artistSlug, targetAlbumSlug });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createAndMaybeMove = async () => {
    if (!newName.trim()) {
      setError("Album name required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/albums/create-with-cover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artistSlug,
          name: newName.trim(),
          style: newStyle.trim() || undefined,
          description: newDescription.trim() || undefined,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        setError(`Create failed: ${t.slice(0, 200)}`);
        return;
      }
      const { slug } = (await r.json()) as { slug: string };
      if (trackId) {
        await move({ id: trackId, targetArtistSlug: artistSlug, targetAlbumSlug: slug });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const otherAlbums = albums.filter((a) => a.slug !== currentAlbumSlug);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm animate-fi"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-lg border bg-elevated p-6 shadow-2xl"
        style={{ borderColor: "var(--color-brd)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between mb-4 pb-3" style={{ borderBottom: "1px solid var(--color-brd)" }}>
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-[1.05rem] font-bold text-paper">
              {view === "new" ? "Create New Album" : trackId ? "Move track to..." : "Albums"}
            </h2>
            <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint">
              {artistSlug}
            </span>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-[0.7rem] text-t3 hover:text-paper transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {view === "select" ? (
          <>
            {trackId && currentAlbumSlug ? (
              <button
                onClick={() => moveToAlbum(undefined)}
                disabled={busy}
                className="w-full mb-4 px-4 py-3 rounded-md border text-left font-display text-[0.85rem] text-paper hover:bg-paper/[0.05] transition-colors disabled:opacity-50"
                style={{ borderColor: "var(--color-brd)" }}
              >
                <span className="text-purple mr-2">∅</span> Unsorted
                <span className="ml-2 font-mono text-[0.6rem] text-t4 uppercase tracking-[0.14em]">no album</span>
              </button>
            ) : null}

            <div
              className="grid"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "1rem" }}
            >
              <button
                onClick={() => setView("new")}
                className="aspect-square rounded-md border-2 border-dashed flex flex-col items-center justify-center transition-colors hover:bg-purple/[0.06]"
                style={{ borderColor: "rgba(139,92,246,0.4)" }}
              >
                <span className="text-3xl text-purple mb-1.5">+</span>
                <span className="font-display text-[0.75rem] font-medium text-purple">New Album</span>
                <span className="font-mono text-[0.55rem] uppercase tracking-[0.14em] text-paper-faint mt-0.5">
                  flux-generated cover
                </span>
              </button>

              {otherAlbums.length === 0 && albums.length === 0 ? (
                <div className="col-span-full text-center py-8 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint/60">
                  no albums yet for {artistSlug}
                </div>
              ) : null}

              {otherAlbums.map((a) => {
                const url = a.coverKey ? get(a.coverKey) : undefined;
                return (
                  <button
                    key={a._id}
                    onClick={() => moveToAlbum(a.slug)}
                    disabled={busy}
                    className="group flex flex-col text-left disabled:opacity-50"
                  >
                    <div
                      className="aspect-square rounded-md border overflow-hidden bg-paper/[0.03] group-hover:ring-2 group-hover:ring-purple/40 transition"
                      style={{ borderColor: "var(--color-brd)" }}
                    >
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={a.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full grid place-items-center font-mono text-[0.55rem] uppercase text-paper-faint/60">
                          no cover
                        </div>
                      )}
                    </div>
                    <div className="mt-2 font-display text-[0.78rem] text-paper truncate">{a.name}</div>
                    <div className="font-mono text-[0.52rem] uppercase tracking-[0.12em] text-paper-faint truncate">
                      {a.slug}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3 max-w-lg mx-auto">
            <Field label="Album name *" hint="What's it called?">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Midnight Rust"
                className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.85rem] focus:outline-none focus:border-purple/50"
                style={{ borderColor: "var(--color-brd)" }}
                autoFocus
                disabled={busy}
              />
            </Field>
            <Field label="Style / genre" hint="Drives the cover art prompt">
              <input
                value={newStyle}
                onChange={(e) => setNewStyle(e.target.value)}
                placeholder="e.g. cinematic synthwave, lo-fi cafe, dark electronic"
                className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.85rem] focus:outline-none focus:border-purple/50"
                style={{ borderColor: "var(--color-brd)" }}
                disabled={busy}
              />
            </Field>
            <Field label="Description / mood" hint="Optional — adds to cover prompt">
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
                placeholder="e.g. moody late-night warm tones, vintage tape texture"
                className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.8rem] focus:outline-none focus:border-purple/50 resize-none"
                style={{ borderColor: "var(--color-brd)" }}
                disabled={busy}
              />
            </Field>
            {error ? (
              <div className="font-mono text-[0.7rem] text-red whitespace-pre-wrap">{error}</div>
            ) : null}
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={createAndMaybeMove}
                disabled={busy || !newName.trim()}
                className="flex-1 px-4 py-2.5 rounded-md bg-purple text-paper font-display text-[0.85rem] hover:bg-purple/90 transition-colors disabled:opacity-50"
              >
                {busy ? "Generating cover…" : trackId ? "Create + move track" : "Create album"}
              </button>
              <button
                onClick={() => setView("select")}
                disabled={busy}
                className="px-4 py-2.5 rounded-md border font-display text-[0.85rem] text-paper-dim hover:text-paper hover:bg-paper/[0.04] transition-colors disabled:opacity-50"
                style={{ borderColor: "var(--color-brd)" }}
              >
                Back
              </button>
            </div>
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.16em] text-paper-faint mt-2">
              Cover is generated by Flux Schnell (~5s, ~$0.003)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint">
        {label}
        {hint ? <span className="text-paper-faint/60 normal-case tracking-normal text-[0.6rem] ml-2">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
