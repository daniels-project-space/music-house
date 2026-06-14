/**
 * Forced lyric alignment for the Music Video pipeline.
 *
 * Transcribes the real audio with Groq whisper-large-v3 (WORD timestamps) and
 * aligns the KNOWN lyric words onto that timeline with a word-level two-pointer
 * match, then interpolates gaps. Emits per-LINE timing AND per-WORD timing so
 * the composition can light each word up as it's sung (karaoke).
 *
 * Falls back to even spacing if transcription fails or matches too poorly.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { getServiceSecrets } from "./vault";

export type LyricLineInput = { text: string; isSection?: boolean };
export type TimedWord = { text: string; start: number };
export type TimedLine = {
  text: string;
  start: number;
  end: number;
  isSection?: boolean;
  words?: TimedWord[];
};

export type AlignResult = {
  lines: TimedLine[];
  method: "forced" | "even";
  confidence: number; // 0..1 fraction of known words matched
};

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

type GroqWord = { word: string; start: number; end: number };

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter(Boolean);
}
const normWord = (s: string): string => tokenize(s)[0] ?? "";

function wordMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3)) return true;
  return false;
}

/** Strip Suno/Mureka metadata preamble (title, "by X", "Album:", separators,
 *  stray [labels]) so only real lyric lines get captioned. */
export function cleanLyricLines(lines: LyricLineInput[], title?: string): LyricLineInput[] {
  const titleNorm = (title ?? "").toLowerCase().trim();
  return lines.filter((l) => {
    if (l.isSection) return true;
    const t = (l.text ?? "").trim();
    if (!t) return false;
    if (/^[\s=\-_*~.•]+$/.test(t)) return false;
    if (/^(by|album|artist|title|written by|produced by|feat\.?|prod\.?)\b\s*:?/i.test(t)) return false;
    if (/^\[[^\]]*\]$/.test(t)) return false;
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
  const r = await fetch(GROQ_URL, { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form });
  if (!r.ok) throw new Error(`Groq transcription failed: ${r.status} ${await r.text().catch(() => "")}`);
  const data = (await r.json()) as { words?: GroqWord[]; segments?: { words?: GroqWord[] }[] };
  const words = data.words ?? data.segments?.flatMap((s) => s.words ?? []) ?? [];
  return words.filter((w) => typeof w.start === "number");
}

/** Distribute word start times across [ls, le], honouring matched anchors. */
function interpWordTimes(times: Array<number | null>, ls: number, le: number): number[] {
  const n = times.length;
  if (!n) return [];
  const anchors: Array<{ idx: number; t: number }> = [{ idx: -1, t: ls }];
  let prev = ls;
  for (let i = 0; i < n; i++) {
    if (times[i] != null) {
      let t = times[i] as number;
      if (t < prev) t = prev;
      if (t > le) t = le;
      anchors.push({ idx: i, t });
      prev = t;
    }
  }
  anchors.push({ idx: n, t: Math.max(le, prev) });
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let L = anchors[0];
    let R = anchors[anchors.length - 1];
    for (let a = 0; a < anchors.length; a++) {
      if (anchors[a].idx <= i) L = anchors[a];
      if (anchors[a].idx >= i) { R = anchors[a]; break; }
    }
    if (L.idx === i) out[i] = L.t;
    else { const span = R.idx - L.idx; out[i] = span > 0 ? L.t + (R.t - L.t) * ((i - L.idx) / span) : L.t; }
  }
  return out;
}

/** Even-spacing fallback (weighted by word count), with even per-word times. */
function evenSpacing(lines: LyricLineInput[], durationSec: number): TimedLine[] {
  const lyric = lines.filter((l) => !l.isSection);
  const weights = lyric.map((l) => Math.max(1, l.text.split(/\s+/).filter(Boolean).length));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const startOf = new Map<LyricLineInput, number>();
  let t = 0;
  lyric.forEach((l, i) => { startOf.set(l, t); t += (weights[i] / total) * durationSec; });
  return buildLines(lines, lyric, startOf, durationSec, () => null);
}

/** Assemble the final TimedLine[] over ALL lines (incl. section markers). */
function buildLines(
  lines: LyricLineInput[],
  lyric: LyricLineInput[],
  startOf: Map<LyricLineInput, number>,
  durationSec: number,
  wordTimeOf: (line: LyricLineInput, wordIdx: number, count: number) => number | null,
): TimedLine[] {
  // monotonic line starts
  let last = 0;
  const sOf = new Map<LyricLineInput, number>();
  for (const l of lyric) { const s = Math.max(startOf.get(l) ?? last, last); last = s; sOf.set(l, s); }
  const eOf = new Map<LyricLineInput, number>();
  for (let i = 0; i < lyric.length; i++) {
    const s = sOf.get(lyric[i])!;
    const e = i + 1 < lyric.length ? sOf.get(lyric[i + 1])! : durationSec;
    eOf.set(lyric[i], Math.max(e, s + 0.4));
  }
  const out: TimedLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.isSection) {
      const next = lines.slice(i + 1).find((x) => !x.isSection);
      const s = next ? sOf.get(next)! : last;
      out.push({ text: l.text, start: s, end: s + 0.4, isSection: true });
      continue;
    }
    const ls = sOf.get(l)!;
    const le = eOf.get(l)!;
    const display = l.text.split(/\s+/).filter(Boolean);
    const times = display.map((_, idx) => wordTimeOf(l, idx, display.length));
    const wt = interpWordTimes(times, ls, le);
    out.push({
      text: l.text,
      start: ls,
      end: le,
      words: display.map((w, idx) => ({ text: w, start: wt[idx] })),
    });
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

  const gw = words.map((w) => ({ w: normWord(w.word), start: w.start })).filter((x) => x.w);
  const lyric = lines.filter((l) => !l.isSection);

  // Per-display-word records (preserve original text for display).
  type KW = { line: LyricLineInput; idx: number; norm: string; time: number | null };
  const byLine = new Map<LyricLineInput, KW[]>();
  const all: KW[] = [];
  for (const line of lyric) {
    const arr: KW[] = line.text.split(/\s+/).filter(Boolean).map((d, idx) => ({ line, idx, norm: normWord(d), time: null }));
    byLine.set(line, arr);
    all.push(...arr);
  }

  // two-pointer match against the ASR word stream
  const WINDOW = 24;
  let gi = 0;
  let matched = 0;
  for (const kw of all) {
    if (!kw.norm) continue;
    let found = -1;
    for (let j = gi; j < Math.min(gw.length, gi + WINDOW); j++) {
      if (wordMatch(kw.norm, gw[j].w)) { found = j; break; }
    }
    if (found >= 0) { kw.time = gw[found].start; gi = found + 1; matched++; }
  }
  const totalNorm = all.filter((k) => k.norm).length || 1;
  const confidence = matched / totalNorm;

  const matchedLines = lyric.filter((l) => byLine.get(l)!.some((k) => k.time != null)).length;
  if (matchedLines < Math.max(2, Math.ceil(lyric.length * 0.25))) {
    return { lines: evenSpacing(lines, durationSec), method: "even", confidence };
  }

  // line start = first matched word; interpolate missing line starts
  const raw = lyric.map((l) => {
    const w = byLine.get(l)!.find((k) => k.time != null);
    return { l, t: w ? (w.time as number) : (null as number | null) };
  });
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].t != null) continue;
    let p = i - 1; while (p >= 0 && raw[p].t == null) p--;
    let n = i + 1; while (n < raw.length && raw[n].t == null) n++;
    const prevT = p >= 0 ? (raw[p].t as number) : 0;
    const nextT = n < raw.length ? (raw[n].t as number) : durationSec;
    raw[i].t = prevT + (nextT - prevT) * ((i - p) / (n - p));
  }
  const startOf = new Map<LyricLineInput, number>(raw.map((x) => [x.l, x.t as number]));

  const wordTimeOf = (line: LyricLineInput, idx: number): number | null => {
    const arr = byLine.get(line);
    return arr ? arr[idx]?.time ?? null : null;
  };

  return { lines: buildLines(lines, lyric, startOf, durationSec, wordTimeOf), method: "forced", confidence };
}
