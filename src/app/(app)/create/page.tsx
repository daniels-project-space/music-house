"use client";
import { useState } from "react";

export default function CreatePage() {
  const [generator, setGenerator] = useState<"suno" | "mureka">("suno");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [title, setTitle] = useState("");
  const [artistSlug, setArtistSlug] = useState("");
  const [albumSlug, setAlbumSlug] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ jobId: string; runId: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generator, prompt, lyrics: lyrics || undefined, title: title || undefined, artistSlug: artistSlug || undefined, albumSlug: albumSlug || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      setResult(j);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="max-w-2xl mx-auto px-8 py-12">
      <h1 className="font-display text-4xl text-paper">Create</h1>
      <p className="text-paper-dim text-sm mt-2 font-mono">Generate a track. Pick your engine.</p>

      <div className="mt-8 grid grid-cols-2 gap-2">
        {(["suno", "mureka"] as const).map((g) => (
          <button key={g} onClick={() => setGenerator(g)}
                  className={`p-4 rounded border font-display text-lg ${generator === g ? "border-amber bg-amber/10 text-amber" : "border-rule-soft/60 text-paper-dim"}`}>
            {g === "suno" ? "Suno V5.5" : "Mureka V8"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="Title" value={title} onChange={setTitle} placeholder="Untitled" />
        <Field label="Style / prompt" value={prompt} onChange={setPrompt} placeholder="lofi jazz piano with rain" required />
        <FieldArea label="Lyrics (optional)" value={lyrics} onChange={setLyrics} placeholder="[Verse 1]&#10;..." />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Artist slug" value={artistSlug} onChange={setArtistSlug} placeholder="cafe-vinyl" />
          <Field label="Album slug" value={albumSlug} onChange={setAlbumSlug} placeholder="echoes" />
        </div>
        <button type="submit" disabled={loading || !prompt}
                className="w-full mt-4 px-4 py-3 rounded bg-amber/20 text-amber border border-amber/40 hover:bg-amber/30 disabled:opacity-30">
          {loading ? "Submitting..." : "Generate"}
        </button>
      </form>

      {err && <div className="mt-4 p-3 rounded bg-red-900/20 border border-red-700/40 text-red-300 text-sm">{err}</div>}
      {result && <div className="mt-4 p-3 rounded bg-paper/5 border border-rule-soft/60">
        <div className="text-paper text-sm">Job created.</div>
        <div className="text-paper-dim font-mono text-xs mt-1">jobId: {result.jobId}</div>
        <div className="text-paper-dim font-mono text-xs">runId: {result.runId}</div>
        <a href="/jobs" className="text-amber font-mono text-xs hover:underline mt-2 inline-block">→ jobs</a>
      </div>}
    </main>
  );
}

function Field({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <label className="block">
      <div className="font-mono text-paper-dim text-xs uppercase tracking-wider">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required}
             className="mt-1 w-full bg-paper/5 border border-rule-soft/60 rounded p-3 text-paper" />
    </label>
  );
}
function FieldArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <div className="font-mono text-paper-dim text-xs uppercase tracking-wider">{label}</div>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
                className="mt-1 w-full bg-paper/5 border border-rule-soft/60 rounded p-3 text-paper min-h-32 font-mono text-sm" />
    </label>
  );
}
