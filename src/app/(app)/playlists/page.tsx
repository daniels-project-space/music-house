"use client";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useState } from "react";

export default function PlaylistsPage() {
  const playlists = useQuery(api.playlists.list, {});
  const create = useMutation(api.playlists.create);
  const remove = useMutation(api.playlists.remove);
  const [name, setName] = useState("");

  return (
    <main className="max-w-[1440px] mx-auto px-8 lg:px-14 py-12">
      <h1 className="font-display text-4xl text-paper">Playlists</h1>
      <form onSubmit={async (e) => { e.preventDefault(); if (name) { await create({ name }); setName(""); } }}
            className="mt-6 flex gap-2 max-w-md">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New playlist name"
               className="flex-1 bg-paper/5 border border-rule-soft/60 rounded p-2 text-paper" />
        <button type="submit" className="px-4 py-2 rounded bg-amber/20 text-amber border border-amber/40">+ Create</button>
      </form>
      <div className="mt-8 space-y-2">
        {(playlists ?? []).map((p) => (
          <div key={p._id} className="border border-rule-soft/60 rounded p-4 flex items-center justify-between">
            <div className="text-paper">{p.name}</div>
            <button onClick={() => remove({ id: p._id })} className="text-paper-dim hover:text-red-400 font-mono text-xs">delete</button>
          </div>
        ))}
      </div>
    </main>
  );
}
