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
  // If provided, defaults artist & current album for context.
  defaultArtistSlug?: string;
  currentAlbumSlug?: string;
};

type View = "select" | "new";

const CATEGORIES = [
  { key: "all", label: "All categories" },
  { key: "film_cinematic", label: "Film & Cinematic" },
  { key: "artist_songs", label: "Artist Songs" },
  { key: "gaming", label: "Gaming" },
] as const;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

const ADD_NEW_ARTIST = "__add_new_artist__";

export function MoveToModal({ open, onClose, trackId, defaultArtistSlug, currentAlbumSlug }: MoveToModalProps) {
  const [view, setView] = useState<View>("select");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<string>("all");

  // New-album form state
  const [artistChoice, setArtistChoice] = useState<string>("");
  const [newArtistName, setNewArtistName] = useState("");
  const [newName, setNewName] = useState("");
  const [newStyle, setNewStyle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const move = useMutation(api.tracks.move);

  const allAlbums = useQuery(api.albums.list, open ? {} : "skip") ?? [];
  const allArtists = useQuery(api.artists.list, open ? {} : "skip") ?? [];

  const visibleAlbums = useMemo(() => {
    if (category === "all") return allAlbums;
    return allAlbums.filter((a) => (a as { section?: string }).section === category);
  }, [allAlbums, category]);

  const coverKeys = useMemo(
    () => visibleAlbums.map((a) => a.coverKey).filter((k): k is string => !!k),
    [visibleAlbums],
  );
  useResolvedUrls(coverKeys);
  const { get } = useUrlCache();

  useEffect(() => {
    if (open) {
      // Reasonable defaults when opening
      setView("select");
      setBusy(false);
      setError(null);
      setNewName("");
      setNewStyle("");
      setNewDescription("");
      setNewArtistName("");
      setArtistChoice(defaultArtistSlug ?? "");
    }
  }, [open, defaultArtistSlug]);

  if (!open) return null;

  const moveToAlbum = async (album: { artistSlug: string; slug: string }) => {
    if (!trackId) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await move({ id: trackId, targetArtistSlug: album.artistSlug, targetAlbumSlug: album.slug });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const moveToUnsorted = async () => {
    if (!trackId || !defaultArtistSlug) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await move({ id: trackId, targetArtistSlug: defaultArtistSlug, targetAlbumSlug: undefined });
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
    let artistSlug: string | undefined;
    let createNewArtist: string | undefined;
    if (artistChoice === ADD_NEW_ARTIST) {
      if (!newArtistName.trim()) {
        setError("New artist name required");
        return;
      }
      createNewArtist = newArtistName.trim();
      artistSlug = slugify(newArtistName.trim());
    } else if (artistChoice) {
      artistSlug = artistChoice;
    } else {
      setError("Pick an artist (or add a new one)");
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
          newArtistName: createNewArtist,
          name: newName.trim(),
          style: newStyle.trim() || undefined,
          description: newDescription.trim() || undefined,
          section: category === "all" ? undefined : category,
        }),
      });
      if (!r.ok) {
        setError(`Create failed: ${(await r.text()).slice(0, 200)}`);
        return;
      }
      const j = (await r.json()) as { slug: string; artistSlug: string };
      if (trackId) {
        await move({ id: trackId, targetArtistSlug: j.artistSlug, targetAlbumSlug: j.slug });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm animate-fi p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[min(95vw,1400px)] max-h-[90vh] overflow-y-auto rounded-lg border bg-elevated p-5 sm:p-6 shadow-2xl"
        style={{ borderColor: "var(--color-brd)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between mb-4 pb-3" style={{ borderBottom: "1px solid var(--color-brd)" }}>
          <h2 className="font-display text-[1.05rem] font-bold text-paper">
            {view === "new" ? "Create new album" : trackId ? "Move track to…" : "Albums"}
          </h2>
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
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint">Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="bg-paper/[0.04] border rounded-md px-2 py-1 text-paper text-[0.78rem] focus:outline-none focus:border-purple/50"
                style={{ borderColor: "var(--color-brd)" }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
              <div className="flex-1" />
              <button
                onClick={() => setView("new")}
                className="px-3 py-1.5 rounded-md bg-purple text-paper font-display text-[0.78rem] hover:bg-purple/90 transition-colors"
              >
                + Create new album
              </button>
            </div>

            {trackId && currentAlbumSlug ? (
              <button
                onClick={moveToUnsorted}
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
              {visibleAlbums.length === 0 ? (
                <div className="col-span-full text-center py-8 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint/60">
                  no albums in {CATEGORIES.find((c) => c.key === category)?.label.toLowerCase()}
                </div>
              ) : null}
              {visibleAlbums.filter((a) => a.slug !== currentAlbumSlug).map((a) => {
                const url = a.coverKey ? get(a.coverKey) : undefined;
                return (
                  <button
                    key={a._id}
                    onClick={() => moveToAlbum({ artistSlug: a.artistSlug, slug: a.slug })}
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
                      {a.artistSlug}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3 max-w-lg mx-auto">
            <Field label="Artist *">
              <select
                value={artistChoice}
                onChange={(e) => setArtistChoice(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.85rem] focus:outline-none focus:border-purple/50"
                style={{ borderColor: "var(--color-brd)" }}
                disabled={busy}
              >
                <option value="">Pick an artist…</option>
                <option value={ADD_NEW_ARTIST}>+ Add new artist</option>
                <option disabled>──────────</option>
                {allArtists.length === 0 ? (
                  <option disabled>(no artists yet)</option>
                ) : null}
                {allArtists.map((a) => (
                  <option key={a._id} value={a.slug}>{a.name}</option>
                ))}
              </select>
            </Field>
            {artistChoice === ADD_NEW_ARTIST ? (
              <Field label="New artist name *">
                <input
                  value={newArtistName}
                  onChange={(e) => setNewArtistName(e.target.value)}
                  placeholder="e.g. Iron Horizon"
                  className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.85rem] focus:outline-none focus:border-purple/50"
                  style={{ borderColor: "var(--color-brd)" }}
                  disabled={busy}
                />
              </Field>
            ) : null}
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.85rem] focus:outline-none focus:border-purple/50"
                style={{ borderColor: "var(--color-brd)" }}
                disabled={busy}
              >
                <option value="all">No category</option>
                {CATEGORIES.filter((c) => c.key !== "all").map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Album name *">
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
                placeholder="e.g. cinematic synthwave, lo-fi cafe"
                className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.85rem] focus:outline-none focus:border-purple/50"
                style={{ borderColor: "var(--color-brd)" }}
                disabled={busy}
              />
            </Field>
            <Field label="Description / mood" hint="Optional">
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
                placeholder="e.g. moody late-night warm tones"
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
                disabled={busy || !newName.trim() || !artistChoice}
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
              Cover via Flux Schnell (~5s, ~$0.003)
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
