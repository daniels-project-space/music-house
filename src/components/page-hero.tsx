"use client";

import { ReactNode } from "react";

type HeaderProps = {
  kicker: string;
  title: string;
  description?: string;
  accent?: "purple" | "pink" | "cyan" | "green" | "amber" | "red";
  stats?: Array<{ label: string; value: string | number; highlight?: boolean }>;
  right?: ReactNode;
  children?: ReactNode;
  // Kept for back-compat with callers; ignored in tight layout.
  emphasis?: string;
};

const ACCENT: Record<string, string> = {
  purple: "#8b5cf6",
  pink: "#ec4899",
  cyan: "#06b6d4",
  green: "#34d399",
  amber: "#fbbf24",
  red: "#ef4444",
};

// Tight legacy-style header strip — kicker + small title + inline meta + stats.
// Replaces the oversized hero that ate 40% of viewport.
export function PageHero({ kicker, title, description, accent = "purple", stats, right, children }: HeaderProps) {
  const dot = ACCENT[accent];
  return (
    <header className="border-b animate-fi" style={{ borderColor: "var(--color-rule-soft)" }}>
      <div className="py-4 lg:py-5 flex items-center gap-6 flex-wrap">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full shrink-0 self-center" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.28em] text-amber/80 leading-none">
            {kicker}
          </p>
          <span className="text-paper-faint/60 text-[0.6rem] leading-none">/</span>
          <h1 className="font-display text-[1.05rem] sm:text-[1.15rem] font-bold tracking-[-0.01em] text-paper leading-none truncate">
            {title}
          </h1>
          {description && (
            <span className="hidden lg:inline text-[0.78rem] text-paper-dim leading-none truncate max-w-md">
              · {description}
            </span>
          )}
        </div>

        <div className="flex items-center gap-5 ml-auto shrink-0">
          {stats && stats.length > 0 && stats.map((s) => (
            <div key={s.label} className="text-right">
              <p className="font-mono text-[0.5rem] uppercase tracking-[0.2em] text-paper-faint leading-none">
                {s.label}
              </p>
              <p
                className={
                  "mt-1 font-mono text-[1.05rem] font-bold tabular-nums leading-none " +
                  (s.highlight ? "title-grad" : "text-paper")
                }
              >
                {typeof s.value === "number" ? String(s.value).padStart(2, "0") : s.value}
              </p>
            </div>
          ))}
          {right}
        </div>
      </div>
      {children}
    </header>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return <main className="max-w-[1600px] mx-auto px-5 sm:px-6 lg:px-8 pt-2 pb-32">{children}</main>;
}
