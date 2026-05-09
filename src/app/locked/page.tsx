"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LockedInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp?.get("next") || "/library";
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      if (r.ok) {
        router.push(next);
      } else {
        setErr("Wrong password");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border bg-card p-6"
        style={{ borderColor: "var(--color-brd)" }}
      >
        <h1 className="font-display text-[1.05rem] font-bold text-paper mb-1">Private</h1>
        <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-paper-faint mb-5">
          enter password to continue
        </p>
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          autoFocus
          autoComplete="current-password"
          placeholder="password"
          className="w-full px-3 py-2 rounded-md bg-paper/[0.04] border text-paper text-[0.9rem] focus:outline-none focus:border-purple/50 mb-3"
          style={{ borderColor: "var(--color-brd)" }}
          disabled={busy}
        />
        {err ? (
          <p className="font-mono text-[0.65rem] text-red mb-3">{err}</p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !pwd}
          className="w-full px-4 py-2.5 rounded-md bg-purple text-paper font-display text-[0.85rem] hover:bg-purple/90 transition-colors disabled:opacity-50"
        >
          {busy ? "checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}

export default function LockedPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <LockedInner />
    </Suspense>
  );
}
