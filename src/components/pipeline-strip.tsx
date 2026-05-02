"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const STAGES: Array<{ key: "generating" | "mixing" | "ready" | "distributed"; label: string; icon: string; color: string; target: string }> = [
  { key: "generating", label: "Generating", icon: "⚡", color: "#ec4899", target: "/studio" },
  { key: "mixing", label: "Mixing", icon: "▦", color: "#8b5cf6", target: "/library?stage=mixing" },
  { key: "ready", label: "Ready", icon: "✓", color: "#34d399", target: "/library?stage=ready" },
  { key: "distributed", label: "Distributed", icon: "📡", color: "#06b6d4", target: "/distribution" },
];

export function PipelineStrip() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const albums = useQuery(api.albums.list, {}) ?? [];
  const jobs = useQuery(api.jobs.list, {}) ?? [];
  const pathname = usePathname();
  const sp = useSearchParams();
  const activeStage = sp?.get("stage");

  const counts = {
    generating: jobs.filter((j) => j.status === "running" || j.status === "pending").length,
    mixing: 0,
    ready: tracks.filter((t) => !t.distributed && !t.archivedAt).length,
    distributed: tracks.filter((t) => t.distributed).length,
  };

  const totalCost = tracks.length * 0.025;
  const monthlyEst = counts.distributed * 2.25 + tracks.length * 0.6;

  return (
    <div
      className="border-b"
      style={{
        borderColor: "var(--color-brd)",
        background: "linear-gradient(90deg, rgba(10,12,18,0.95), rgba(14,17,24,0.92))",
      }}
    >
      <div className="px-5 sm:px-6 lg:px-8 h-9 flex items-center gap-1 overflow-x-auto whitespace-nowrap">
        <div className="flex items-center gap-0 shrink-0">
          {STAGES.map((s, i) => {
            const n = counts[s.key];
            const dim = n === 0;
            const active =
              (s.key === "generating" && pathname?.startsWith("/studio")) ||
              (s.key === "distributed" && pathname?.startsWith("/distribution")) ||
              activeStage === s.key;
            return (
              <div key={s.key} className="flex items-center shrink-0">
                {i > 0 && <span className="text-paper-faint/40 text-[0.55rem] px-1">→</span>}
                <Link
                  href={s.target}
                  className={
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all " +
                    (active ? "bg-paper/[0.04]" : "hover:bg-paper/[0.025]")
                  }
                >
                  <span className="text-[0.78rem] leading-none" style={{ color: dim ? "rgba(148,163,184,0.4)" : s.color, filter: active ? `drop-shadow(0 0 6px ${s.color})` : "none" }}>
                    {s.icon}
                  </span>
                  <span
                    className={
                      "font-mono text-[0.85rem] font-bold leading-none tabular-nums " +
                      (dim ? "text-paper-faint" : "")
                    }
                    style={{ color: dim ? undefined : s.color }}
                  >
                    {n}
                  </span>
                  <span
                    className={
                      "font-mono text-[0.5rem] uppercase tracking-[0.14em] leading-none " +
                      (active ? "text-paper" : "text-paper-faint")
                    }
                  >
                    {s.label}
                  </span>
                </Link>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4 ml-auto shrink-0">
          <Stat value={tracks.length} label="Tracks" />
          <Stat value={albums.length} label="Albums" />
          <Stat value={`$${totalCost.toFixed(0)}`} label="Cost" />
          <Stat value={`$${monthlyEst.toFixed(2)}`} label="Est. Monthly" gradient />
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, gradient }: { value: string | number; label: string; gradient?: boolean }) {
  return (
    <div className="text-right shrink-0">
      <div
        className={
          "font-mono text-[0.78rem] font-bold leading-none tabular-nums " +
          (gradient ? "title-grad" : "text-paper")
        }
      >
        {value}
      </div>
      <div className="font-mono text-[0.45rem] uppercase tracking-[0.14em] text-paper-faint mt-1 leading-none">
        {label}
      </div>
    </div>
  );
}
