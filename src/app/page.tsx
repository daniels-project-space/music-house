export default function Home() {
  return (
    <main className="min-h-dvh">
      <header className="border-b border-rule-soft/60">
        <div className="max-w-[1440px] mx-auto px-8 lg:px-14 pt-12 pb-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-amber/80">
            Music House / 2026
          </p>
          <h1 className="mt-2 font-display text-[64px] leading-[1.02] tracking-tight text-paper">
            Music <span className="italic text-paper-dim">House</span>
          </h1>
          <p className="mt-3 max-w-xl text-paper-dim text-[15px] leading-relaxed">
            AI music label. Generate with Suno or Mureka, organize into artists and albums,
            keep timestamped lyrics, hearts, and distribution status in one place.
          </p>
        </div>
      </header>
      <section className="max-w-[1440px] mx-auto px-8 lg:px-14 py-16">
        <p className="text-paper-dim">
          Scaffolded. Run <code className="font-mono text-amber">npx convex dev</code> to provision the backend.
        </p>
      </section>
    </main>
  );
}
