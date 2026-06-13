/**
 * Forced lyric alignment for the Music Video pipeline.
 *
 * Music House stores lyric TEXT (Suno/Mureka) but the per-line timestamps are
 * unreliable. We transcribe the real audio with Groq whisper-large-v3 (word
 * timestamps) and align the KNOWN good lyric lines onto that timeline with a
 * word-level two-pointer match, then interpolate any gaps. Output drives the
 * synced captions in the composition.
 *
 * Falls back to even spacing if transcription fails or matches too poorly.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { getServiceSecrets } from "./vault";

export type LyricLineInput = { text: string; isSection?: boolean };
export type TimedLine = { text: string; start: number; end: number; isSection?: boolean };

export type AlignResult = {
  lines: TimedLine[];
  method: "forced" | "even";
  confidence: number; // 0..1 fraction of known words matched
};

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

type GroqWord = { word: string; start: number; end: number };

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function wordMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // Shared 3-char prefix tolerates ASR mishears / inflections on sung vocals.
  if (a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3)) return true;
  return false;
}

/**
 * Strip the metadata preamble Suno/Mureka embed in lyric text (title, "by X",
 * "Album: …", separator rules, stray bracketed labels) so only real lyric lines
 * get captioned. Section markers (isSection) are kept for structure.
 */
export function cleanLyricLines(lines: LyricLineInput[], title?: string): LyricLineInput[] {
  const titleNorm = (title ?? "").toLowerCase().trim();
  return lines.filter((l) => {
    if (l.isSection) return true;
    const t = (l.text ?? "").trim();
    if (!t) return false;
    if (/^[\s=\-_*~.•]+$/.test(t)) return false; // separator rules
    if (/^(by|album|artist|title|written by|produced by|feat\.?|prod\.?)\b\s*:?/i.test(t)) return false;
    if (/^\[[^\]]*\]$/.test(t)) return false; // stray [bracketed] labels not flagged as sections
    if (titleNorm && t.toLowerCase() === titleNorm) return false;
    return true;
  });
}

async function groqKey(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  const env = await getServiceSecrets("groq");
  const k = env.GROQ_API_KEY;
  if (!k) throw new Error("GROQ_API_KEY not available (env or vault service 'groq')");
  return k;
}

async function transcribeWords(audioPath: string, apiKey: string): Promise<GroqWord[]> {
  const bytes = await readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), basename(audioPath));
  form.append("model", "whisper-large-v3");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("prompt", "Song lyrics.");

  const r = await fetch(GROQ_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!r.ok) throw new Error(`Groq transcription failed: ${r.status} ${await r.text().catch(() => "")}`);
  const data = (await r.json()) as { words?: GroqWord[]; segments?: { words?: GroqWord[] }[] };
  const words = data.words ?? data.segments?.flatMap((s) => s.words ?? []) ?? [];
  return words.filter((w) => typeof w.start === "number");
}

/** Even-spacing fallback weighted by each line's word count. */
function evenSpacing(lines: LyricLineInput[], durationSec: number): TimedLine[] {
  const lyric = lines.filter((l) => !l.isSection);
  const weights = lyric.map((l) => Math.max(1, tokenize(l.text).length));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  const startByRef = new Map<LyricLineInput, number>();
  lyric.forEach((l, i) => {
    startByRef.set(l, t);
    t += (weights[i] / total) * durationSec;
  });
  return toTimed(lines, startByRef, durationSec);
}

/** Build final TimedLine[] from a per-line start map, enforcing monotonic
 *  starts and computing ends from the next line. Section markers inherit the
 *  start of the following lyric line. */
function toTimed(
  lines: LyricLineInput[],
  startByRef: Map<LyricLineInput, number>,
  durationSec: number,
): TimedLine[] {
  let lastStart = 0;
  const resolved = lines.map((l) => {
    if (l.isSection) return { line: l, start: NaN };
    let s = startByRef.get(l);
    if (s == null || Number.isNaN(s)) s = lastStart;
    s = Math.max(s, lastStart);
    lastStart = s;
    return { line: l, start: s };
  });
  for (let i = 0; i < resolved.length; i++) {
    if (resolved[i].line.isSection) {
      const next = resolved.slice(i + 1).find((r) => !r.line.isSection);
      resolved[i].start = next ? next.start : lastStart;
    }
  }
  const out: TimedLine[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const start = Math.min(resolved[i].start, durationSec);
    const end = i + 1 < resolved.length ? Math.min(resolved[i + 1].start, durationSec) : durationSec;
    out.push({ text: resolved[i].line.text, start, end: Math.max(end, start + 0.4), isSection: resolved[i].line.isSection });
  }
  return out;
}

export async function alignLyrics(opts: {
  audioPath: string;
  lines: LyricLineInput[];
  durationSec: number;
  apiKey?: string;
}): Promise<AlignResult> {
  const { audioPath, lines, durationSec } = opts;
  if (!lines.length) return { lines: [], method: "even", confidence: 0 };

  let words: GroqWord[] = [];
  try {
    words = await transcribeWords(audioPath, await groqKey(opts.apiKey));
  } catch {
    return { lines: evenSpacing(lines, durationSec), method: "even", confidence: 0 };
  }
  if (words.length < 8) return { lines: evenSpacing(lines, durationSec), method: "even", confidence: 0 };

  const gw = words.map((w) => ({ w: tokenize(w.word)[0] ?? "", start: w.start })).filter((x) => x.w);

  const lyric = lines.filter((l) => !l.isSection);
  // Flatten known lyric words, each tagged with its line.
  const known: Array<{ line: LyricLineInput; w: string }> = [];
  for (const line of lyric) for (const w of tokenize(line.text)) known.push({ line, w });

  // Two-pointer alignment: walk known words, find each in the ASR stream within
  // a forward window. First matched word of a line anchors that line's start.
  const WINDOW = 24;
  let gi = 0;
  let matched = 0;
  const lineStart = new Map<LyricLineInput, number>();
  for (const k of known) {
    let found = -1;
    for (let j = gi; j < Math.min(gw.length, gi + WINDOW); j++) {
      if (wordMatch(k.w, gw[j].w)) {
        found = j;
        break;
      }
    }
    if (found >= 0) {
      gi = found + 1;
      matched++;
      if (!lineStart.has(k.line)) lineStart.set(k.line, gw[found].start);
    }
  }

  const confidence = known.length ? matched / known.length : 0;
  if (lineStart.size < Math.max(2, Math.ceil(lyric.length * 0.25))) {
    return { lines: evenSpacing(lines, durationSec), method: "even", confidence };
  }

  // Interpolate starts for lyric lines that got no anchor, between neighbours.
  const startByRef = new Map<LyricLineInput, number>();
  const anchored = lyric.map((l) => ({ l, t: lineStart.get(l) }));
  // leading gap → from 0; trailing gap → toward duration
  for (let i = 0; i < anchored.length; i++) {
    if (anchored[i].t != null) {
      startByRef.set(anchored[i].l, anchored[i].t as number);
      continue;
    }
    // find prev + next anchored
    let p = i - 1;
    while (p >= 0 && anchored[p].t == null) p--;
    let n = i + 1;
    while (n < anchored.length && anchored[n].t == null) n++;
    const prevT = p >= 0 ? (anchored[p].t as number) : 0;
    const nextT = n < anchored.length ? (anchored[n].t as number) : durationSec;
    const span = n - p; // number of steps
    const frac = (i - p) / span;
    startByRef.set(anchored[i].l, prevT + (nextT - prevT) * frac);
  }

  return { lines: toTimed(lines, startByRef, durationSec), method: "forced", confidence };
}
