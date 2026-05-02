"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const STAGES: Array<{ key: "generating" | "mixing" | "ready" | "distributed"; label: string; icon: string; color: string }> = [
  { key: "generating", label: "Generating", icon: "⚡", color: "text-pink" },
  { key: "mixing", label: "Mixing", icon: "▦", color: "text-purple" },
  { key: "ready", label: "Ready", icon: "✓", color: "text-green" },
  { key: "distributed", label: "Distributed", icon: "📡", color: "text-cyan" },
];

export function PipelineStrip() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const albums = useQuery(api.albums.list, {}) ?? [];
  const jobs = useQuery(api.jobs.list, {}) ?? [];

  const counts = {
    generating: jobs.filter((j) => j.status === "running" || j.status === "pending").length,
    mixing: 0,
    ready: tracks.filter((t) => !t.distributed && !t.archivedAt).length,
    distributed: tracks.filter((t) => t.distributed).length,
  };

  const totalCost = tracks.length * 0.025;
  const monthlyEst = tracks.filter((t) => t.distributed).length * 2.25 + tracks.length * 0.6;

  return (
    <div
      className="px-6 lg:px-10 py-2 flex items-center gap-1 overflow-x-auto"
      style={{ background: "linear-gradient(90deg, var(--color-bg2), rgba(14,17,24,0.95))", borderBottom: "1px solid var(--color-brd)" }}
    >
      <div className="max-w-[1440px] mx-auto w-full flex items-center gap-1">
        <div className="flex items-center gap-0 flex-1">
          {STAGES.map((s, i) => (
            <div key={s.key} className="flex items-center">
              {i > 0 && <span className="text-t4 text-[0.65rem] px-1 shrink-0">→</span>}
              <button className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-white/3 transition shrink-0">
                <span className="text-[0.8rem]">{s.icon}</span>
                <div className="text-left">
                  <div className={"font-mono text-[0.95rem] font-bold leading-none " + s.color}>{counts[s.key]}</div>
                  <div className="font-mono text-[0.5rem] uppercase tracking-[0.06em] text-t3 mt-0.5">{s.label}</div>
                </div>
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-4 ml-auto shrink-0">
          <Stat value={tracks.length} label="Tracks" />
          <Stat value={albums.length} label="Albums" />
          <Stat value={"$" + totalCost.toFixed(0)} label="Cost" />
          <Stat value={"$" + monthlyEst.toFixed(2)} label="Est. Monthly" gradient />
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, gradient }: { value: string | number; label: string; gradient?: boolean }) {
  return (
    <div className="text-right">
      <div className={"font-mono text-[0.8rem] font-bold leading-none " + (gradient ? "title-grad" : "text-t1")}>{value}</div>
      <div className="font-mono text-[0.45rem] uppercase tracking-[0.06em] text-t3 mt-1">{label}</div>
    </div>
  );
}
