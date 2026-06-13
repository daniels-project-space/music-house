"use client";

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";

type Job = {
  jobId: string;
  status: string;
  progress: string | null;
  error: string | null;
  title: string;
  artist: string;
  videoKey: string | null;
  previewUrl: string | null;
  youtubeUrl: string | null;
  alignMethod: string | null;
  fireAt: number;
  createdAt: number;
  updatedAt: number;
};

const STATUS_STYLES: Record<string, string> = {
  scheduled: "text-paper-dim bg-paper/[0.05]",
  rendering: "text-cyan bg-cyan/10",
  uploading: "text-cyan bg-cyan/10",
  rendered: "text-purple bg-purple/10",
  held: "text-purple bg-purple/10",
  published: "text-pink bg-pink/10",
  failed: "text-red-400 bg-red-500/10",
};

const ACTIVE = new Set(["scheduled", "rendering", "uploading"]);
const PLAYABLE = new Set(["rendered", "held", "published"]);

function fmt(ts: number) {
  return new Date(ts).toLocaleString();
}

/** Resolves a fresh presigned URL from the R2 key (presigned URLs expire). */
function VideoPlayer({ videoKey, fallback }: { videoKey: string; fallback: string | null }) {
  const [url, setUrl] = useState<string | null>(fallback);
  useEffect(() => {
    let alive = true;
    fetch(`/api/video?key=${encodeURIComponent(videoKey)}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.url) setUrl(d.url);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [videoKey]);
  if (!url) return null;
  return (
    <video
      controls
      preload="metadata"
      src={url}
      className="mt-3 w-full max-w-xl rounded-lg border border-paper/[0.06] bg-black"
    />
  );
}

export default function VideosPage() {
  const jobs = useQuery(api.musicVideo.listJobs, { limit: 50 }) as Job[] | undefined;

  return (
    <div className="flex-1 min-w-0 flex flex-col p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-display text-2xl text-paper">Music Videos</h1>
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-paper-faint mt-1">
          render pipeline · output stored on R2
        </p>
      </header>

      {jobs === undefined && <p className="text-paper-dim text-sm">Loading…</p>}
      {jobs && jobs.length === 0 && (
        <p className="text-paper-dim text-sm">
          No video jobs yet. A job is created automatically 5 days after a single is released, or
          on demand via the render script.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {jobs?.map((j) => (
          <div key={j.jobId} className="rounded-lg border border-paper/[0.06] bg-bg2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-display text-paper text-base truncate">{j.title}</div>
                <div className="font-mono text-[0.62rem] text-paper-dim truncate">{j.artist}</div>
              </div>
              <span
                className={`shrink-0 font-mono text-[0.55rem] uppercase tracking-[0.14em] px-2 py-1 rounded-md ${
                  STATUS_STYLES[j.status] ?? "text-paper-dim bg-paper/[0.05]"
                }`}
              >
                {j.status}
              </span>
            </div>

            {ACTIVE.has(j.status) && j.progress && (
              <div className="mt-2 font-mono text-[0.62rem] text-cyan">▸ {j.progress}</div>
            )}
            {j.status === "failed" && j.error && (
              <div className="mt-2 font-mono text-[0.6rem] text-red-400 break-words">{j.error}</div>
            )}

            {j.videoKey && PLAYABLE.has(j.status) && (
              <VideoPlayer videoKey={j.videoKey} fallback={j.previewUrl} />
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[0.55rem] text-paper-faint">
              <span>updated {fmt(j.updatedAt)}</span>
              {j.alignMethod && <span>lyrics: {j.alignMethod}</span>}
              {j.youtubeUrl && (
                <a href={j.youtubeUrl} target="_blank" rel="noreferrer" className="text-pink underline">
                  YouTube
                </a>
              )}
              {j.videoKey && (
                <a
                  href={`/api/video?key=${encodeURIComponent(j.videoKey)}&redirect=1`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-purple underline"
                >
                  open / download
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
