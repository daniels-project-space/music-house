/**
 * Forced lyric alignment for the Music Video pipeline.
 *
 * Music House stores lyric TEXT (from Suno/Mureka) but the per-line timestamps
 * are unreliable (often all 0). To make karaoke lyrics that actually track the
 * music, we transcribe the real audio with Groq's whisper-large-v3 (word-level
 * timestamps) and align the KNOWN good lyric lines onto that timeline.
 *
 * Graceful degradation: if transcription fails or matches poorly, we fall back
 * to even spacing across the track duration so the render never breaks.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { getServiceSecrets } from "./vault";

export type LyricLineInput = { text: string; isSection?: boolean };
export type TimedLine = { text: string; start: number; end: number; isSection?: boolean };

export type AlignResult = {
  lines: TimedLine[];
  method: "forced" | "even";
  /** 0..1 — fraction of lyric lines that matched a transcribed word. */
  confidence: number;
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
  // Hint the model this is lyrical/musical content.
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

/** Even-spacing fallback: distribute lyric lines proportionally to their word count. */
function evenSpacing(lines: LyricLineInput[], durationSec: number): TimedLine[] {
  const lyricLines = lines.filter((l) => !l.isSection);
  const weights = lyricLines.map((l) => Math.max(1, tokenize(l.text).length));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  const startByRef = new Map<LyricLineInput, number>();
  lyricLines.forEach((l, i) => {
    startByRef.set(l, t);
    t += (weights[i] / total) * durationSec;
  });
  return toTimed(lines, startByRef, durationSec);
}

/** Build final TimedLine[] from a per-line start map, fixing monotonicity + ends. */
function toTimed(
  lines: LyricLineInput[],
  startByRef: Map<LyricLineInput, number>,
  durationSec: number,
): TimedLine[] {
  // Resolve starts for lyric lines, then attach section markers to the next lyric line.
  const out: TimedLine[] = [];
  // First pass: ordered starts for lyric lines.
  let lastStart = 0;
  const resolved = lines.map((l) => {
    if (l.isSection) return { line: l, start: NaN };
    let s = startByRef.get(l);
    if (s == null || Number.isNaN(s)) s = lastStart;
    s = Math.max(s, lastStart);
    lastStart = s;
    return { line: l, start: s };
  });
  // Section markers inherit the start of the following lyric line.
  for (let i = 0; i < resolved.length; i++) {
    if (resolved[i].line.isSection) {
      const next = resolved.slice(i + 1).find((r) => !r.line.isSection);
      resolved[i].start = next ? next.start : lastStart;
    }
  }
  // Ends = next entry's start (or duration).
  for (let i = 0; i < resolved.length; i++) {
    const start = Math.min(resolved[i].start, durationSec);
    const end = i + 1 < resolved.length ? Math.min(resolved[i + 1].start, durationSec) : durationSec;
    out.push({
      text: resolved[i].line.text,
      start,
      end: Math.max(end, start + 0.4),
      isSection: resolved[i].line.isSection,
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
    const key = await groqKey(opts.apiKey);
    words = await transcribeWords(audioPath, key);
  } catch {
    return { lines: evenSpacing(lines, durationSec), method: "even", confidence: 0 };
  }
  if (words.length < 8) {
    return { lines: evenSpacing(lines, durationSec), method: "even", confidence: 0 };
  }

  const gw = words.map((w) => ({ w: tokenize(w.word)[0] ?? "", start: w.start }));
  const startByRef = new Map<LyricLineInput, number>();
  const lyricLines = lines.filter((l) => !l.isSection);

  let cursor = 0;
  let matched = 0;
  const WINDOW = 40; // how far ahead to search for a line's opening word
  for (const line of lyricLines) {
    const toks = tokenize(line.text);
    if (!toks.length) {
      startByRef.set(line, cursor < gw.length ? gw[cursor].start : durationSec);
      continue;
    }
    const head = toks[0];
    let found = -1;
    for (let i = cursor; i < Math.min(gw.length, cursor + WINDOW); i++) {
      if (gw[i].w === head || (head.length > 3 && gw[i].w.startsWith(head.slice(0, 4)))) {
        found = i;
        break;
      }
    }
    if (found >= 0) {
      startByRef.set(line, gw[found].start);
      cursor = found + Math.max(1, Math.floor(toks.length * 0.7));
      matched++;
    } else {
      // leave unset → toTimed will clamp it to the previous start
    }
  }

  const confidence = lyricLines.length ? matched / lyricLines.length : 0;
  if (confidence < 0.25) {
    return { lines: evenSpacing(lines, durationSec), method: "even", confidence };
  }
  return { lines: toTimed(lines, startByRef, durationSec), method: "forced", confidence };
}
