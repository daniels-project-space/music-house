/**
 * Forced lyric alignment for the Music Video pipeline.
 *
 * Transcribes the real audio with Groq whisper-large-v3 (WORD timestamps), then
 * aligns the KNOWN lyric words onto that timeline with a global Needleman–Wunsch
 * alignment (optimal; correctly handles ASR insertions/deletions/mishears, so
 * words don't get mis-assigned and drift early/late). Emits per-LINE and
 * per-WORD timing so the composition can light each word as it's sung.
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

/** Similarity score for the NW matrix. */
function scoreOf(a: string, b: string): number {
  if (a && b) {
    if (a === b) return 3;
    if (a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3)) return 2;
  }
  return -2; // mismatch
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

/**
 * Needleman–Wunsch global alignment of the known lyric word stream to the ASR
 * word stream. Returns, for each known word, the matched ASR start time (or
 * null if it aligned to a gap). Globally optimal — far fewer mis-assignments
 * than a greedy pass, which is what caused words to trigger early/late.
 */
function alignNW(knownNorms: string[], gw: { w: string; start: number }[]): Array<number | null> {
  const m = knownNorms.length;
  const n = gw.length;
  const GAP = -1;
  const dp: Float64Array[] = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
  const tb: Int8Array[] = Array.from({ length: m + 1 }, () => new Int8Array(n + 1));
  for (let i = 1; i <= m; i++) { dp[i][0] = i * GAP; tb[i][0] = 1; }
  for (let j = 1; j <= n; j++) { dp[0][j] = j * GAP; tb[0][j] = 2; }
  for (let i = 1; i <= m; i++) {
    const a = knownNorms[i - 1];
    const dpi = dp[i];
    const dpim1 = dp[i - 1];
    const tbi = tb[i];
    for (let j = 1; j <= n; j++) {
      const diag = dpim1[j - 1] + scoreOf(a, gw[j - 1].w);
      const up = dpim1[j] + GAP;
      const left = dpi[j - 1] + GAP;
      let best = diag;
      let dir = 0;
      if (up > best) { best = up; dir = 1; }
      if (left > best) { best = left; dir = 2; }
      dpi[j] = best;
      tbi[j] = dir;
    }
  }
  const times: Array<number | null> = new Array(m).fill(null);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const dir = tb[i][j];
    if (dir === 0) {
      if (scoreOf(knownNorms[i - 1], gw[j - 1].w) > -2) times[i - 1] = gw[j - 1].start;
      i--; j--;
    } else if (dir === 1) {
      i--;
    } else {
      j--;
    }
  }
  return times;
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

function evenSpacing(lines: LyricLineInput[], durationSec: number): TimedLine[] {
  const lyric = lines.filter((l) => !l.isSection);
  const weights = lyric.map((l) => Math.max(1, l.text.split(/\s+/).filter(Boolean).length));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const startOf = new Map<LyricLineInput, number>();
  let t = 0;
  lyric.forEach((l, i) => { startOf.set(l, t); t += (weights[i] / total) * durationSec; });
  return buildLines(lines, lyric, startOf, durationSec, () => null);
}

/** Assemble final TimedLine[] over ALL lines (incl. section markers). */
function buildLines(
  lines: LyricLineInput[],
  lyric: LyricLineInput[],
  startOf: Map<LyricLineInput, number>,
  durationSec: number,
  wordTimeOf: (line: LyricLineInput, wordIdx: number) => number | null,
): TimedLine[] {
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
    const times = display.map((_, idx) => wordTimeOf(l, idx));
    const wt = interpWordTimes(times, ls, le);
    out.push({ text: l.text, start: ls, end: le, words: display.map((w, idx) => ({ text: w, start: wt[idx] })) });
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

  type KW = { line: LyricLineInput; idx: number; norm: string; time: number | null };
  const byLine = new Map<LyricLineInput, KW[]>();
  const all: KW[] = [];
  for (const line of lyric) {
    const arr: KW[] = line.text.split(/\s+/).filter(Boolean).map((d, idx) => ({ line, idx, norm: normWord(d), time: null }));
    byLine.set(line, arr);
    all.push(...arr);
  }

  // Global optimal alignment of known words → ASR words.
  const times = alignNW(all.map((k) => k.norm), gw);
  let matched = 0;
  all.forEach((kw, idx) => {
    kw.time = times[idx];
    if (kw.time != null) matched++;
  });
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
  const wordTimeOf = (line: LyricLineInput, idx: number): number | null => byLine.get(line)?.[idx]?.time ?? null;

  return { lines: buildLines(lines, lyric, startOf, durationSec, wordTimeOf), method: "forced", confidence };
}
