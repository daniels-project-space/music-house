"use client";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

export default function JobsPage() {
  const jobs = useQuery(api.jobs.list, {});
  return (
    <main className="max-w-[1440px] mx-auto px-8 lg:px-14 py-12">
      <h1 className="font-display text-4xl text-paper">Generation Jobs</h1>
      <p className="text-paper-dim text-sm mt-2 font-mono">{jobs?.length ?? 0} total</p>
      <div className="mt-8 space-y-2">
        {(jobs ?? []).slice().reverse().map((j) => (
          <div key={j._id} className="border border-rule-soft/60 rounded p-4 flex items-center justify-between">
            <div className="flex-1">
              <div className="text-paper text-sm">{j.prompt.slice(0, 80)}</div>
              <div className="text-paper-dim font-mono text-xs mt-1">{j.generator} · {new Date(j.createdAt).toISOString().slice(0, 19)}</div>
              {j.error && <div className="text-red-400 font-mono text-xs mt-1">{j.error}</div>}
            </div>
            <span className={`font-mono text-xs uppercase tracking-wider px-2 py-1 rounded ${j.status === 'complete' ? 'bg-green-900/30 text-green-400' : j.status === 'failed' ? 'bg-red-900/30 text-red-400' : j.status === 'running' ? 'bg-amber/20 text-amber' : 'bg-paper/10 text-paper-dim'}`}>
              {j.status}
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
