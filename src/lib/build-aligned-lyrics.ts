export type LyricLine = { text: string; start: number; isSection: boolean };

export type AlignedLyricWord = {
  word: string;
  startS: number;
  success?: boolean;
};

type KnownToken = { lineIndex: number; normalized: string };
type TimedToken = { normalized: string; start: number | null };

const SECTION_LINE = /^\[.+\]$/;
const GAP_SCORE = -1;
const MATCH_SCORE = 3;
const MISMATCH_SCORE = -2;

function tokenize(text: string): string[] {
  return (
    text
      .normalize("NFKD")
      .toLocaleLowerCase("en")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\p{M}/gu, "")
      .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? []
  );
}

function tokenizeAlignedWords(alignedWords: AlignedLyricWord[]): TimedToken[] {
  return alignedWords.flatMap((entry) => {
    // Suno's documented response can combine a section marker and the first
    // sung word in one item (for example, "[Verse]\nWaggin'"). Markers are
    // structure rather than sung tokens and must not occupy an alignment slot.
    const normalizedWords = tokenize((entry.word ?? "").replace(/\[[^\]]*\]/g, " "));
    const start =
      entry.success !== false && Number.isFinite(entry.startS) ? entry.startS : null;
    return normalizedWords.map((normalized) => ({ normalized, start }));
  });
}

/**
 * Globally align the original lyric tokens with Suno's timed token stream.
 *
 * A sequence alignment is necessary here: Suno may omit an unsung word or add
 * a vocal interjection. Advancing by the original whitespace count makes every
 * later line drift by one timestamp after either event.
 */
function alignTokenStarts(known: KnownToken[], timed: TimedToken[]): Array<number | null> {
  const knownCount = known.length;
  const timedCount = timed.length;
  const starts: Array<number | null> = new Array(knownCount).fill(null);
  if (knownCount === 0 || timedCount === 0) return starts;

  // Keep only the traceback matrix. Score rows can be recycled, which bounds
  // score storage even for long custom lyrics.
  const traceback = Array.from(
    { length: knownCount + 1 },
    () => new Uint8Array(timedCount + 1),
  );
  let previous = new Int32Array(timedCount + 1);
  let current = new Int32Array(timedCount + 1);
  for (let j = 1; j <= timedCount; j++) {
    previous[j] = j * GAP_SCORE;
    traceback[0][j] = 2; // left: skip an extra timed token
  }

  for (let i = 1; i <= knownCount; i++) {
    current[0] = i * GAP_SCORE;
    traceback[i][0] = 1; // up: original token was omitted
    for (let j = 1; j <= timedCount; j++) {
      const matches = known[i - 1].normalized === timed[j - 1].normalized;
      const diagonal = previous[j - 1] + (matches ? MATCH_SCORE : MISMATCH_SCORE);
      const up = previous[j] + GAP_SCORE;
      const left = current[j - 1] + GAP_SCORE;

      let score = diagonal;
      let direction = 0;
      if (up > score) {
        score = up;
        direction = 1;
      }
      if (left > score) {
        score = left;
        direction = 2;
      }
      current[j] = score;
      traceback[i][j] = direction;
    }
    [previous, current] = [current, previous];
  }

  let i = knownCount;
  let j = timedCount;
  while (i > 0 || j > 0) {
    const direction = traceback[i][j];
    if (i > 0 && j > 0 && direction === 0) {
      if (known[i - 1].normalized === timed[j - 1].normalized) {
        starts[i - 1] = timed[j - 1].start;
      }
      i--;
      j--;
    } else if (i > 0 && (j === 0 || direction === 1)) {
      i--;
    } else {
      j--;
    }
  }

  return starts;
}

function fillMissingStarts(starts: Array<number | null>): number[] {
  const filled = starts.slice();
  let index = 0;

  while (index < filled.length) {
    if (filled[index] !== null) {
      index++;
      continue;
    }

    const runStart = index;
    while (index < filled.length && filled[index] === null) index++;
    const previousIndex = runStart - 1;
    const nextIndex = index;
    const previous = previousIndex >= 0 ? filled[previousIndex] : null;
    const next = nextIndex < filled.length ? filled[nextIndex] : null;

    for (let missing = runStart; missing < nextIndex; missing++) {
      if (previous !== null && next !== null) {
        const progress = (missing - previousIndex) / (nextIndex - previousIndex);
        filled[missing] = previous + (next - previous) * progress;
      } else if (next !== null) {
        filled[missing] = next;
      } else if (previous !== null) {
        filled[missing] = previous;
      } else {
        filled[missing] = 0;
      }
    }
  }

  let last = 0;
  return filled.map((start) => {
    const finite = typeof start === "number" && Number.isFinite(start) ? start : 0;
    last = Math.max(last, finite);
    return last;
  });
}

/**
 * Map Suno word timestamps back onto the original lyric-line structure.
 * Section headers borrow the next sung line's time; a trailing section borrows
 * the preceding line so the returned timeline stays monotonic.
 */
export function buildAlignedLyrics(
  originalText: string,
  alignedWords: AlignedLyricWord[],
): LyricLine[] {
  const rawLines = originalText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (rawLines.length === 0) return [];

  const lyricLineIndexes: number[] = [];
  const knownTokens: KnownToken[] = [];
  rawLines.forEach((line, lineIndex) => {
    if (SECTION_LINE.test(line)) return;
    lyricLineIndexes.push(lineIndex);
    for (const normalized of tokenize(line)) {
      knownTokens.push({ lineIndex, normalized });
    }
  });

  const tokenStarts = alignTokenStarts(knownTokens, tokenizeAlignedWords(alignedWords));
  const firstStartByLine = new Map<number, number>();
  knownTokens.forEach((token, tokenIndex) => {
    const start = tokenStarts[tokenIndex];
    if (start !== null && !firstStartByLine.has(token.lineIndex)) {
      firstStartByLine.set(token.lineIndex, start);
    }
  });

  const lyricStarts = fillMissingStarts(
    lyricLineIndexes.map((lineIndex) => firstStartByLine.get(lineIndex) ?? null),
  );
  const startByLine = new Map(
    lyricLineIndexes.map((lineIndex, lyricIndex) => [lineIndex, lyricStarts[lyricIndex]]),
  );

  return rawLines.map((text, lineIndex) => {
    const isSection = SECTION_LINE.test(text);
    if (!isSection) {
      return { text, start: startByLine.get(lineIndex) ?? 0, isSection: false };
    }

    const nextLyricIndex = lyricLineIndexes.find((candidate) => candidate > lineIndex);
    const previousLyricIndex = lyricLineIndexes.findLast((candidate) => candidate < lineIndex);
    const start =
      (nextLyricIndex === undefined ? undefined : startByLine.get(nextLyricIndex)) ??
      (previousLyricIndex === undefined ? undefined : startByLine.get(previousLyricIndex)) ??
      0;
    return { text, start, isSection: true };
  });
}
