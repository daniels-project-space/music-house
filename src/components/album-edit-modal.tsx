"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useUrlCache, useResolvedUrls } from "./url-cache-provider";

type Props = {
  open: boolean;
  onClose: () => void;
  albumId: Id<"albums">;
};

const CATEGORIES = [
  { key: "", label: "No category" },
  { key: "film_cinematic", label: "Film & Cinematic" },
  { key: "artist_songs", label: "Artist Songs" },
  { key: "gaming", label: "Gaming" },
];

const ADD_NEW_ARTIST = "__add_new_artist__";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function AlbumEditModal({ open, onClose, albumId }: Props) {
  const album = useQuery(api.albums.list, open ? {} : "skip")?.find((a) => a._id === albumId);
  const allArtists = useQuery(api.artists.list, open ? {} : "skip") ?? [];
  const setMeta = useMutation(api.albums.setMeta);
  const reassignArtist = useMutation(api.albums.reassignArtist);
  const upsertArtist = useMutation(api.artists.upsert);
  const { get } = useUrlCache();
  useResolvedUrls(album?.coverKey ? [album.coverKey] : []);

  const [name, setName] = useState("");
  const [genre, setGenre] = useState("");
  const [description, setDescription] = useState("");
  const [section, setSection] = useState("");
  const [artistChoice, setArtistChoice] = useState("");
  const [newArtistName, setNewArtistName] = useState("");

  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverBumpKey, setCoverBumpKey] = useState(0);

  useEffect(() => {
    if (open && album) {
      setName(album.name);
      setGenre(album.genre ?? "");
      setDescription(album.description ?? "");
      setSection((album as { section?: string }).section ?? "");
      setArtistChoice(album.artistSlug);
      setNewArtistName("");
      setError(null);
      setCoverBumpKey((k) => k + 1);
    }
  }, [open, album]);

  if (!open) return null;

  const save = async () => {
    if (!album) return;
    setSaving(true);
    setError(null);
    try {
      // Resolve target artist
      let targetArtist = album.artistSlug;
      if (artistChoice === ADD_NEW_ARTIST) {
        const trimmed = newArtistName.trim();
        if (!trimmed) {
          setError("New artist name required");
          setSaving(false);
          return;
        }
        const slug = slugify(trimmed);
        await upsertArtist({ slug, name: trimmed, genres: [] });
        targetArtist = slug;
      } else if (artistChoice) {
        targetArtist = artistChoice;
      }

      await setMeta({
        id: albumId,
        name: name.trim() || undefined,
        genre: genre.trim() || undefined,
        description: description.trim() || undefined,
        section: section || undefined,
      });

      if (targetArtist !== album.artistSlug) {
        await reassignArtist({ id: albumId, newArtistSlug: targetArtist });
      }

      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const regenerateCover = async () => {
    if (!album) return;
    setRegenerating(true);
    setError(null);
    try {
      const r = await fetch("/api/albums/regen-cover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          albumId,
          style: genre.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });
      if (!r.ok) {
        setError(`Cover gen failed: ${(await r.text()).slice(0, 200)}`);
        return;
      }
      // useQuery will refetch the album with the new coverKey
      setCoverBumpKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRegenerating(false);
    }
  };

  const coverUrl = album?.coverKey ? get(album.coverKey) : undefined;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm animate-fi"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg border bg-elevated p-6 shadow-2xl"
        style={{ borderColor: "var(--color-brd)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between mb-4 pb-3" style={{ borderBottom: "1px solid var(--color-brd)" }}>
          <h2 className="font-display text-[1.05rem] font-bold text-paper">
            Edit album · {album?.name ?? "…"}
          </h2>
          <button
            onClick={onClose}
            className="font-mono text-[0.7rem] text-t3 hover:text-paper transition-colors"
          >
            ✕
          </button>
        </div>

        {!album ? (
          <div className="font-mono text-[0.65rem] text-t3 py-6 text-center">Loading…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-5">
            {/* Cover preview + regen */}
            <div className="flex flex-col gap-2">
              <div
                key={coverBumpKey}
                className="aspect-square rounded-md border overflow-hidden bg-paper/[0.03]"
                style={{ borderColor: "var(--color-brd)" }}
              >
                {coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full grid place-items-center font-mono text-[0.55rem] uppercase text-paper-faint/60">
                    no cover
                  </div>
                )}
              </div>
              <button
                onClick={regenerateCover}
                disabled={regenerating || saving}
                className="px-3 py-2 rounded-md border border-purple/40 text-purple font-mono text-[0.6rem] uppercase tracking-[0.16em] hover:bg-purple/[0.06] transition-colors disabled:opacity-50"
              >
                {regenerating ? "Generating…" : "↻ Regen cover (Flux)"}
              </button>
            </div>

            {/* Form */}
            <div className="flex flex-col gap-3">
              <Field label="Album name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.85rem] focus:outline-none focus:border-purple/50"
                  style={{ borderColor: "var(--color-brd)" }}
                  disabled={saving}
                />
              </Field>
              <Field label="Artist" hint="Changing this moves all tracks too">
                <select
                  value={artistChoice}
                  onChange={(e) => setArtistChoice(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.85rem] focus:outline-none focus:border-purple/50"
                  style={{ borderColor: "var(--color-brd)" }}
                  disabled={saving}
                >
                  <option value={ADD_NEW_ARTIST}>+ Add new artist</option>
                  <option disabled>──────────</option>
                  {allArtists.map((a) => (
                    <option key={a._id} value={a.slug}>{a.name}</option>
                  ))}
                </select>
              </Field>
              {artistChoice === ADD_NEW_ARTIST ? (
                <Field label="New artist name">
                  <input
                    value={newArtistName}
                    onChange={(e) => setNewArtistName(e.target.value)}
                    placeholder="e.g. Iron Horizon"
                    className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.85rem] focus:outline-none focus:border-purple/50"
                    style={{ borderColor: "var(--color-brd)" }}
                    disabled={saving}
                  />
                </Field>
              ) : null}
              <Field label="Category">
                <select
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.85rem] focus:outline-none focus:border-purple/50"
                  style={{ borderColor: "var(--color-brd)" }}
                  disabled={saving}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Style / genre">
                <input
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="e.g. cinematic synthwave"
                  className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.85rem] focus:outline-none focus:border-purple/50"
                  style={{ borderColor: "var(--color-brd)" }}
                  disabled={saving}
                />
              </Field>
              <Field label="Description / mood">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.8rem] focus:outline-none focus:border-purple/50 resize-none"
                  style={{ borderColor: "var(--color-brd)" }}
                  disabled={saving}
                />
              </Field>
              {error ? (
                <div className="font-mono text-[0.7rem] text-red whitespace-pre-wrap">{error}</div>
              ) : null}
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={save}
                  disabled={saving || regenerating}
                  className="flex-1 px-4 py-2.5 rounded-md bg-purple text-paper font-display text-[0.85rem] hover:bg-purple/90 transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="px-4 py-2.5 rounded-md border font-display text-[0.85rem] text-paper-dim hover:text-paper hover:bg-paper/[0.04] transition-colors disabled:opacity-50"
                  style={{ borderColor: "var(--color-brd)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
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
