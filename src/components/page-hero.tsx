"use client";

import { ReactNode } from "react";

type HeroProps = {
  kicker: string;
  title: string;
  emphasis?: string;
  description: string;
  accent?: "purple" | "pink" | "cyan" | "green" | "amber" | "red";
  stats?: Array<{ label: string; value: string | number; highlight?: boolean }>;
  children?: ReactNode;
};

const ACCENTS: Record<string, string> = {
  purple: "rgba(139,92,246,0.55)",
  pink: "rgba(236,72,153,0.55)",
  cyan: "rgba(6,182,212,0.55)",
  green: "rgba(52,211,153,0.55)",
  amber: "rgba(251,191,36,0.55)",
  red: "rgba(239,68,68,0.55)",
};

export function PageHero({ kicker, title, emphasis, description, accent = "purple", stats, children }: HeroProps) {
  return (
    <header className="border-b border-rule-soft/60 mb-14 lg:mb-16 animate-fi">
      <div className="pt-12 lg:pt-14 pb-10 lg:pb-12 flex items-end justify-between gap-8 flex-wrap">
        <div className="max-w-2xl">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.32em] text-amber/80 leading-none">
            {kicker}
          </p>
          <h1 className="mt-3 font-display text-[3rem] sm:text-[3.5rem] lg:text-[4rem] xl:text-[4.5rem] font-extrabold leading-[0.96] tracking-[-0.02em] text-paper">
            {title}
            {emphasis && (
              <>
                {" "}
                <span className="italic font-light text-paper-dim">{emphasis}</span>
              </>
            )}
            <span style={{ color: ACCENTS[accent] }}>.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[0.95rem] sm:text-[1rem] text-paper-dim leading-relaxed">
            {description}
          </p>
        </div>

        {stats && stats.length > 0 && (
          <div className="hidden md:flex items-center gap-7">
            {stats.map((s, i) => (
              <div key={s.label} className="flex items-center gap-7">
                {i > 0 && <span className="h-12 w-px bg-rule-soft" />}
                <div className="text-right">
                  <p className="font-mono text-[0.6rem] uppercase tracking-[0.3em] text-paper-faint leading-none">
                    {s.label}
                  </p>
                  <p
                    className={
                      "mt-2.5 font-display text-[2.4rem] lg:text-[2.6rem] font-extrabold tabular-nums leading-none " +
                      (s.highlight ? "title-grad" : "text-paper")
                    }
                  >
                    {typeof s.value === "number" ? String(s.value).padStart(2, "0") : s.value}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {children}
    </header>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return <main className="max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-14 pb-32">{children}</main>;
}
