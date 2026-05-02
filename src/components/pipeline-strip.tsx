"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const STAGES: Array<{ key: "generating" | "mixing" | "ready" | "distributed"; label: string; dot: string; target: string }> = [
  { key: "generating", label: "Generating", dot: "#ec4899", target: "/studio" },
  { key: "mixing", label: "Mixing", dot: "#8b5cf6", target: "/library?stage=mixing" },
  { key: "ready", label: "Ready", dot: "#34d399", target: "/library?stage=ready" },
  { key: "distributed", label: "Distributed", dot: "#06b6d4", target: "/distribution" },
];

export function PipelineStrip() {
  const tracks = useQuery(api.tracks.list, {}) ?? [];
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

  return (
    <div
      className="border-b"
      style={{ borderColor: "var(--color-rule-soft)", background: "rgba(10,12,18,0.4)" }}
    >
      <div className="max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-14 h-9 flex items-center gap-5 overflow-x-auto">
        {STAGES.map((s, i) => {
          const n = counts[s.key];
          const dim = n === 0;
          const active =
            (s.key === "generating" && pathname?.startsWith("/studio")) ||
            (s.key === "distributed" && pathname?.startsWith("/distribution")) ||
            (activeStage === s.key);
          return (
            <div key={s.key} className="flex items-center gap-3 shrink-0">
              {i > 0 && <span className="text-paper-faint/40 text-[0.6rem]">·</span>}
              <Link
                href={s.target}
                className={
                  "flex items-center gap-2 rounded transition-opacity " +
                  (dim ? "opacity-60 hover:opacity-100" : "hover:opacity-100")
                }
              >
                <span
                  className={"w-1.5 h-1.5 rounded-full " + (s.key === "generating" && n > 0 ? "animate-pulse-dot" : "")}
                  style={{ background: dim ? "rgba(148,163,184,0.25)" : s.dot, boxShadow: active ? `0 0 8px ${s.dot}` : "none" }}
                />
                <span
                  className={
                    "font-mono text-[0.6rem] uppercase tracking-[0.22em] " +
                    (active ? "text-paper" : dim ? "text-paper-faint" : "text-paper-dim")
                  }
                >
                  {s.label}
                </span>
                <span
                  className={
                    "font-mono text-[0.66rem] tabular-nums leading-none " +
                    (active ? "text-paper" : dim ? "text-paper-faint" : "text-paper")
                  }
                >
                  {String(n).padStart(2, "0")}
                </span>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
