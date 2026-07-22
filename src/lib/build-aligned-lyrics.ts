export type LyricLine = { text: string; start: number; isSection: boolean };

// Build karaoke-ready lines by mapping Suno's word-level timestamps back onto
// the original lyric text's line structure. We walk the aligned words in order,
// consuming one per sung (non-section) line word, and stamp each line's start
// with the startS of its first matched word. Section headers ([Verse], …) get
// no words of their own — their start is borrowed from the next sung line.
export function buildAlignedLyrics(
  originalText: string,
  alignedWords: Array<{ word: string; startS: number }>,
): LyricLine[] {
  const rawLines = originalText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (rawLines.length === 0) return [];

  // Count of word-tokens we expect to consume for each non-section line, so the
  // pointer into alignedWords advances in lockstep with the original text.
  // Suno sometimes glues a section marker onto the next sung word
  // (e.g. "[Verse]\nWaggin'"). Strip any leading [..] marker so the token still
  // counts as the sung word and its startS is preserved.
  const words = alignedWords
    .map((w) => {
      const cleaned = (w.word ?? "").replace(/^\s*\[[^\]]*\]\s*/g, "").trim();
      return { word: cleaned, startS: w.startS };
    })
    .filter((w) => w.word.length > 0);
  let wi = 0;
  const lines: LyricLine[] = [];

  for (const line of rawLines) {
    const isSection = /^\[.+\]$/.test(line);
    if (isSection) {
      // Section header: start = the upcoming sung word (filled in a second pass).
      lines.push({ text: line, start: -1, isSection: true });
      continue;
    }
    const tokenCount = line.split(/\s+/).filter(Boolean).length || 1;
    const firstStart = wi < words.length ? words[wi].startS : 0;
    lines.push({ text: line, start: Number.isFinite(firstStart) ? firstStart : 0, isSection: false });
    wi = Math.min(words.length, wi + tokenCount);
  }

  // Resolve section-header starts to the next sung line's start (or 0).
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start !== -1) continue;
    let next = 0;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].isSection) {
        next = lines[j].start;
        break;
      }
    }
    lines[i].start = next;
  }

  return lines;
}
