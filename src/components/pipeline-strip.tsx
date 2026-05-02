"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const STAGES: Array<{ key: "generating" | "mixing" | "ready" | "distributed"; label: string; dot: string }> = [
  { key: "generating", label: "Generating", dot: "#ec4899" },
  { key: "mixing", label: "Mixing", dot: "#8b5cf6" },
  { key: "ready", label: "Ready", dot: "#34d399" },
  { key: "distributed", label: "Distributed", dot: "#06b6d4" },
];

export function PipelineStrip() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
  const jobs = useQuery(api.jobs.list, {}) ?? [];

  const counts = {
    generating: jobs.filter((j) => j.status === "running" || j.status === "pending").length,
    mixing: 0,
    ready: tracks.filter((t) => !t.distributed && !t.archivedAt).length,
    distributed: tracks.filter((t) => t.distributed).length,
  };

  return (
    <div
      className="border-b"
      style={{ borderColor: "var(--color-rule-soft)", background: "rgba(10,12,18,0.4)" }}
    >
      <div className="max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-14 h-9 flex items-center gap-6 overflow-x-auto">
        {STAGES.map((s, i) => {
          const n = counts[s.key];
          const dim = n === 0;
          return (
            <div key={s.key} className="flex items-center gap-3 shrink-0">
              {i > 0 && <span className="text-paper-faint/60 text-[0.6rem]">·</span>}
              <div className="flex items-center gap-2">
                <span
                  className={"w-1.5 h-1.5 rounded-full " + (s.key === "generating" && n > 0 ? "animate-pulse-dot" : "")}
                  style={{ background: dim ? "rgba(148,163,184,0.25)" : s.dot }}
                />
                <span
                  className={
                    "font-mono text-[0.6rem] uppercase tracking-[0.22em] " +
                    (dim ? "text-paper-faint" : "text-paper-dim")
                  }
                >
                  {s.label}
                </span>
                <span
                  className={
                    "font-mono text-[0.66rem] tabular-nums leading-none " +
                    (dim ? "text-paper-faint" : "text-paper")
                  }
                >
                  {String(n).padStart(2, "0")}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
