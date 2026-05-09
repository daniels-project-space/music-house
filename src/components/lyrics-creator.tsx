"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export function LyricsCreator() {
  const saved = useQuery(api.savedLyrics.list, {}) ?? [];
  const create = useMutation(api.savedLyrics.create);
  const remove = useMutation(api.savedLyrics.remove);

  const [title, setTitle] = useState("");
  const [vibe, setVibe] = useState("");
  const [theme, setTheme] = useState("");
  const [topic, setTopic] = useState("");
  const [genre, setGenre] = useState("");
  const [generated, setGenerated] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const generate = async () => {
    setError(null);
    if (!vibe.trim() && !theme.trim() && !topic.trim() && !genre.trim()) {
      setError("Need at least one of: vibe, theme, topic, genre");
      return;
    }
    setGenerating(true);
    try {
      const r = await fetch("/api/lyrics/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          vibe: vibe.trim() || undefined,
          theme: theme.trim() || undefined,
          topic: topic.trim() || undefined,
          genre: genre.trim() || undefined,
        }),
      });
      if (!r.ok) {
        setError((await r.text()).slice(0, 240));
        return;
      }
      const j = (await r.json()) as { lyrics: string };
      setGenerated(j.lyrics);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    if (!generated.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await create({
        title: title.trim() || "Untitled",
        vibe: vibe.trim() || undefined,
        theme: theme.trim() || undefined,
        topic: topic.trim() || undefined,
        genre: genre.trim() || undefined,
        lyrics: generated,
      });
      // Reset form
      setTitle("");
      setVibe("");
      setTheme("");
      setTopic("");
      setGenre("");
      setGenerated("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-brd bg-card p-4 backdrop-blur">
      <div className="flex items-center justify-between mb-4">
        <p className="label-mono">Lyrics Creator</p>
        <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint">Sonnet 4.6</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <Input value={title} onChange={setTitle} placeholder="Title (optional)" />
        <Input value={genre} onChange={setGenre} placeholder="Genre (e.g. lo-fi, synthwave)" />
        <Input value={vibe} onChange={setVibe} placeholder="Vibe (e.g. melancholy, nostalgic)" />
        <Input value={theme} onChange={setTheme} placeholder="Theme (e.g. lost love, road trip)" />
      </div>
      <Input value={topic} onChange={setTopic} placeholder="Topic / story (longer description)" textarea />

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={generate}
          disabled={generating || saving}
          className="px-4 py-2 rounded-md bg-purple text-paper font-display text-[0.8rem] hover:bg-purple/90 transition-colors disabled:opacity-50"
        >
          {generating ? "Writing…" : "✨ Generate lyrics"}
        </button>
        {generated ? (
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-md border border-green/40 text-green font-display text-[0.8rem] hover:bg-green/[0.06] transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "💾 Save"}
          </button>
        ) : null}
        {error ? (
          <span className="font-mono text-[0.6rem] text-red ml-2">{error}</span>
        ) : null}
      </div>

      {generated ? (
        <textarea
          value={generated}
          onChange={(e) => setGenerated(e.target.value)}
          className="w-full mt-3 bg-paper/[0.04] border border-brd rounded-md p-3 text-[0.78rem] text-t1 min-h-48 outline-none focus:border-purple/50 transition-colors leading-relaxed font-mono"
        />
      ) : null}

      {saved.length > 0 ? (
        <div className="mt-5 pt-4 border-t border-brd/50">
          <p className="label-mono mb-2">Saved ({saved.length})</p>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {saved.map((l) => (
              <div key={l._id} className="rounded border border-brd/40 hover:border-brd transition-colors">
                <button
                  onClick={() => setExpandedId(expandedId === l._id ? null : l._id)}
                  className="w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="font-mono text-[0.6rem] text-paper-faint transition-transform"
                      style={{ transform: expandedId === l._id ? "rotate(90deg)" : "rotate(0deg)" }}
                    >
                      ▶
                    </span>
                    <span className="font-display text-[0.78rem] text-paper truncate">{l.title}</span>
                    {l.genre ? (
                      <span className="font-mono text-[0.5rem] uppercase tracking-[0.14em] text-paper-faint truncate">{l.genre}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${l.title}"?`)) remove({ id: l._id as Id<"savedLyrics"> });
                    }}
                    className="font-mono text-[0.55rem] uppercase tracking-[0.14em] text-paper-faint hover:text-red transition-colors px-1.5"
                  >
                    ✕
                  </button>
                </button>
                {expandedId === l._id ? (
                  <pre className="px-3 pb-3 text-[0.7rem] text-paper-dim font-mono whitespace-pre-wrap leading-relaxed">{l.lyrics}</pre>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  textarea,
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder: string;
  textarea?: boolean;
}) {
  if (textarea) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full bg-paper/[0.04] border border-brd rounded-md p-2.5 text-[0.78rem] text-t1 outline-none focus:border-purple/50 transition-colors leading-relaxed resize-none"
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-paper/[0.04] border border-brd rounded-md px-2.5 py-2 text-[0.78rem] text-t1 outline-none focus:border-purple/50 transition-colors"
    />
  );
}
