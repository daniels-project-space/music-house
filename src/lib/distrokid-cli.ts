import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Typed wrapper around a FUTURE agent-native DistroKid CLI binary.
//
// The real CLI does not exist yet — it will be generated later by Printing Press
// against a HAR capture of the DistroKid web flow. Until that binary is wired in,
// `runDistrokidCli` is INERT: it throws at the single invocation boundary so no
// release can ever be submitted accidentally.
//
// Structure: one subprocess boundary (runDistrokidCli below), typed step payloads,
// and every step funneling through that single boundary so the real CLI swaps in
// at exactly one spot.

const execP = promisify(execFile);

// ---------------------------------------------------------------------------
// Shared types — imported by src/trigger/distribute-single-distrokid.ts
// ---------------------------------------------------------------------------

/** Cookie jar entry passed to the DistroKid CLI. */
export type CookieEntry = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

/** Reference to a single audio asset (buffer-based). */
export type DistrokidAudio = {
  audioBuffer: Buffer | Uint8Array;
  audioFilename: string;
  audioContentType: string; // e.g. "audio/wav", "audio/flac"
};

/** Reference to release artwork. DistroKid requires exactly 3000x3000 px. */
export type DistrokidArtwork = {
  imageBuffer: Buffer | Uint8Array;
  imageFilename: string;
  imageContentType: string; // e.g. "image/jpeg", "image/png"
  widthPx: number;
  heightPx: number;
};

/** AI-disclosure declaration. DistroKid requires this be explicitly set before submit. */
export type DistrokidAiDisclosure = {
  /** true if any AI tools were used to create the recording. */
  usedAi: boolean;
  /** Optional free-text describing the AI involvement (vocals, mastering, etc.). */
  details?: string;
};

/** Store / territory selection. */
export type DistrokidStoreSelection = {
  /** DistroKid store ids to deliver to (e.g. "spotify", "apple"). Empty = all stores. */
  storeIds: string[];
  /** ISO 3166-1 alpha-2 territory codes to include. Empty = worldwide. */
  territories: string[];
};

/** Per-track metadata, including lyrics. */
export type DistrokidTrack = {
  title: string;
  trackNumber: number;
  artistName: string;
  isrc?: string;
  explicit: boolean;
  language: string;
  /** Plain-text lyrics (optional but funneled through trackMetadata when present). */
  lyrics?: string;
  songwriters: string[];
  audio: DistrokidAudio;
};

/** Top-level release metadata payload. */
export type DistrokidReleasePayload = {
  releaseTitle: string;
  artistName: string;
  genre: string;
  secondaryGenre?: string;
  label?: string;
  language: string;
  /** ISO date string (YYYY-MM-DD). */
  releaseDate: string;
  upc?: string;
  copyrightYear: string;
  copyrightName: string;
  tracks: DistrokidTrack[];
  artwork: DistrokidArtwork;
  aiDisclosure?: DistrokidAiDisclosure;
  stores?: DistrokidStoreSelection;
  /** Pinned streaming-profile ids; when set, the save payload reuses the
   *  existing artist instead of the "new artist" sentinel. */
  artistIdentity?: { spotifyArtistId?: string; appleArtistId?: string };
};

/** Result of a single CLI invocation. */
export type DistrokidCliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** Outcome of one submit-flow step. */
export type DistrokidStepResult = { step: string; ok: boolean; detail?: string };

/** Final result of the full submit flow. */
export type DistrokidSubmitResult = {
  submitted: boolean;
  releaseId?: string;
  upc?: string;
  steps: DistrokidStepResult[];
  liveViewUrl?: string;
};

// ---------------------------------------------------------------------------
// THE ONE invocation boundary.
//
// This is the single place that will later spawn the real DistroKid CLI binary
// (a single subprocess boundary). Until Printing Press emits that binary, it is
// INERT and throws.
// ---------------------------------------------------------------------------

export const DISTROKID_CLI_NOT_WIRED =
  "DistroKid CLI not yet wired — run Printing Press against a HAR capture first";

/**
 * Spawns the future agent-native DistroKid CLI with the given args.
 *
 * @param args  CLI argument vector (subcommand + flags).
 * @param opts  Runtime options. `cookies` is the serialized auth jar passed to the CLI.
 *
 * INERT: throws {@link DISTROKID_CLI_NOT_WIRED} until the real binary is wired.
 * When wired, the body below (commented) will spawn the subprocess and parse its output.
 */
export async function runDistrokidCli(
  args: string[],
  opts: { cookies: string },
): Promise<DistrokidCliResult> {
  // --- WIRED (single-spot swap) -------------------------------------------
  // Resolve the binary by PATH (installed at /usr/local/bin/distrokid-cli).
  // Auth cookie jar is passed via DISTROKID_COOKIES (the CLI reads it from env).
  // execFile rejects on non-zero exit, so capture that to surface exitCode/stderr.
  try {
    const { stdout, stderr } = await execP("distrokid-cli", args, {
      maxBuffer: 200 * 1024 * 1024,
      env: { ...process.env, DISTROKID_COOKIES: opts.cookies },
    });
    return { exitCode: 0, stdout, stderr };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    const exitCode = typeof err.code === "number" ? err.code : 1;
    return {
      exitCode,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? "",
    };
  }
  // ------------------------------------------------------------------------
}

// ---------------------------------------------------------------------------
// Typed submit-flow contract.
//
// Each step is a typed function that funnels through runDistrokidCli, so wiring
// the real CLI is a one-spot change. The steps are listed in submit order.
// ---------------------------------------------------------------------------

function serializeCookies(cookies: CookieEntry[]): string {
  return JSON.stringify(cookies);
}

/** Step 1 — create the release shell, returns the new release id. */
export async function createRelease(
  payload: DistrokidReleasePayload,
  cookies: CookieEntry[],
): Promise<DistrokidCliResult> {
  return runDistrokidCli(
    ["create-release", "--title", payload.releaseTitle, "--artist", payload.artistName],
    { cookies: serializeCookies(cookies) },
  );
}

/** Step 2 — set top-level release info (genre, label, dates, copyright). */
export async function releaseInfo(
  releaseId: string,
  payload: DistrokidReleasePayload,
  cookies: CookieEntry[],
): Promise<DistrokidCliResult> {
  return runDistrokidCli(
    [
      "release-info",
      "--release",
      releaseId,
      "--genre",
      payload.genre,
      "--language",
      payload.language,
      "--release-date",
      payload.releaseDate,
      "--copyright-year",
      payload.copyrightYear,
      "--copyright-name",
      payload.copyrightName,
    ],
    { cookies: serializeCookies(cookies) },
  );
}

/** Step 3 — upload one track's audio asset. */
export async function uploadAudio(
  releaseId: string,
  track: DistrokidTrack,
  cookies: CookieEntry[],
): Promise<DistrokidCliResult> {
  return runDistrokidCli(
    [
      "upload-audio",
      "--release",
      releaseId,
      "--track",
      String(track.trackNumber),
      "--file",
      track.audio.audioFilename,
      "--content-type",
      track.audio.audioContentType,
    ],
    { cookies: serializeCookies(cookies) },
  );
}

/** Step 4 — upload the release artwork (must be 3000x3000 px). */
export async function uploadArtwork(
  releaseId: string,
  artwork: DistrokidArtwork,
  cookies: CookieEntry[],
): Promise<DistrokidCliResult> {
  return runDistrokidCli(
    [
      "upload-artwork",
      "--release",
      releaseId,
      "--file",
      artwork.imageFilename,
      "--content-type",
      artwork.imageContentType,
      "--width",
      String(artwork.widthPx),
      "--height",
      String(artwork.heightPx),
    ],
    { cookies: serializeCookies(cookies) },
  );
}

/** Step 5 — set per-track metadata including lyrics. */
export async function trackMetadata(
  releaseId: string,
  track: DistrokidTrack,
  cookies: CookieEntry[],
): Promise<DistrokidCliResult> {
  const args = [
    "track-metadata",
    "--release",
    releaseId,
    "--track",
    String(track.trackNumber),
    "--title",
    track.title,
    "--artist",
    track.artistName,
    "--language",
    track.language,
    "--explicit",
    track.explicit ? "1" : "0",
    "--songwriters",
    track.songwriters.join("|"),
  ];
  if (track.isrc) args.push("--isrc", track.isrc);
  if (track.lyrics) args.push("--lyrics", track.lyrics);
  return runDistrokidCli(args, { cookies: serializeCookies(cookies) });
}

/** Step 6 — set the mandatory AI-disclosure declaration. */
export async function setAiDisclosure(
  releaseId: string,
  disclosure: DistrokidAiDisclosure,
  cookies: CookieEntry[],
): Promise<DistrokidCliResult> {
  const args = [
    "set-ai-disclosure",
    "--release",
    releaseId,
    "--used-ai",
    disclosure.usedAi ? "1" : "0",
  ];
  if (disclosure.details) args.push("--details", disclosure.details);
  return runDistrokidCli(args, { cookies: serializeCookies(cookies) });
}

/** Step 7 — select stores / territories (empty selection = all). */
export async function selectStores(
  releaseId: string,
  selection: DistrokidStoreSelection,
  cookies: CookieEntry[],
): Promise<DistrokidCliResult> {
  return runDistrokidCli(
    [
      "select-stores",
      "--release",
      releaseId,
      "--stores",
      selection.storeIds.join(","),
      "--territories",
      selection.territories.join(","),
    ],
    { cookies: serializeCookies(cookies) },
  );
}

/** Step 8 — persist the release as a draft (idempotent checkpoint before submit). */
export async function saveDraft(
  releaseId: string,
  cookies: CookieEntry[],
): Promise<DistrokidCliResult> {
  return runDistrokidCli(["save-draft", "--release", releaseId], {
    cookies: serializeCookies(cookies),
  });
}

/** Step 9 — final submit. Guarded by validateBeforeSubmit upstream. */
export async function submit(
  releaseId: string,
  cookies: CookieEntry[],
): Promise<DistrokidCliResult> {
  return runDistrokidCli(["submit", "--release", releaseId], {
    cookies: serializeCookies(cookies),
  });
}

/** Ordered submit-flow contract — the canonical step sequence for the Trigger task. */
export const distrokidSubmitFlow = {
  createRelease,
  releaseInfo,
  uploadAudio,
  uploadArtwork,
  trackMetadata,
  setAiDisclosure,
  selectStores,
  saveDraft,
  submit,
} as const;

// ---------------------------------------------------------------------------
// Pre-submit validation — pure function, HARD-THROWS on any invalid field.
// Runs before submit() in the Trigger task.
// ---------------------------------------------------------------------------

const REQUIRED_ARTWORK_PX = 3000;

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function bufferLength(buf: Buffer | Uint8Array | undefined | null): number {
  if (!buf) return 0;
  return buf.byteLength ?? (buf as Buffer).length ?? 0;
}

/**
 * Pure validation gate. Throws a clear Error on the FIRST violation found.
 * Checks: artwork dimensions, every track's audio buffer, required metadata
 * fields, and that AI-disclosure has been explicitly set.
 */
export function validateBeforeSubmit(payload: DistrokidReleasePayload): void {
  // Release-level required metadata.
  if (isBlank(payload.releaseTitle)) {
    throw new Error("validateBeforeSubmit: releaseTitle is blank");
  }
  if (isBlank(payload.artistName)) {
    throw new Error("validateBeforeSubmit: artistName is blank");
  }
  if (isBlank(payload.genre)) {
    throw new Error("validateBeforeSubmit: genre is blank");
  }
  if (isBlank(payload.language)) {
    throw new Error("validateBeforeSubmit: language is blank");
  }
  if (isBlank(payload.releaseDate)) {
    throw new Error("validateBeforeSubmit: releaseDate is blank");
  }
  if (isBlank(payload.copyrightYear)) {
    throw new Error("validateBeforeSubmit: copyrightYear is blank");
  }
  if (isBlank(payload.copyrightName)) {
    throw new Error("validateBeforeSubmit: copyrightName is blank");
  }

  // Artwork: must exist and be EXACTLY 3000x3000 px.
  if (!payload.artwork) {
    throw new Error("validateBeforeSubmit: artwork is missing");
  }
  if (bufferLength(payload.artwork.imageBuffer) === 0) {
    throw new Error("validateBeforeSubmit: artwork image buffer is missing or zero-length");
  }
  if (
    payload.artwork.widthPx !== REQUIRED_ARTWORK_PX ||
    payload.artwork.heightPx !== REQUIRED_ARTWORK_PX
  ) {
    throw new Error(
      `validateBeforeSubmit: artwork must be exactly ${REQUIRED_ARTWORK_PX}x${REQUIRED_ARTWORK_PX} px, got ${payload.artwork.widthPx}x${payload.artwork.heightPx}`,
    );
  }

  // Tracks: at least one, each with valid audio + required metadata.
  if (!Array.isArray(payload.tracks) || payload.tracks.length === 0) {
    throw new Error("validateBeforeSubmit: payload has no tracks");
  }
  for (let i = 0; i < payload.tracks.length; i++) {
    const t = payload.tracks[i];
    const label = `track ${i + 1}`;
    if (isBlank(t.title)) {
      throw new Error(`validateBeforeSubmit: ${label} title is blank`);
    }
    if (isBlank(t.artistName)) {
      throw new Error(`validateBeforeSubmit: ${label} artistName is blank`);
    }
    if (isBlank(t.language)) {
      throw new Error(`validateBeforeSubmit: ${label} language is blank`);
    }
    if (!t.audio || bufferLength(t.audio.audioBuffer) === 0) {
      throw new Error(`validateBeforeSubmit: ${label} audio buffer is missing or zero-length`);
    }
    if (isBlank(t.audio.audioFilename)) {
      throw new Error(`validateBeforeSubmit: ${label} audio filename is blank`);
    }
  }

  // AI-disclosure MUST be explicitly set (undefined/null is a hard fail).
  if (payload.aiDisclosure === undefined || payload.aiDisclosure === null) {
    throw new Error(
      "validateBeforeSubmit: aiDisclosure is unset — it must be explicitly declared before submit",
    );
  }
  if (typeof payload.aiDisclosure.usedAi !== "boolean") {
    throw new Error("validateBeforeSubmit: aiDisclosure.usedAi must be a boolean");
  }
}
