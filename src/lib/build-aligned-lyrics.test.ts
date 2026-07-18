import assert from "node:assert/strict";
import test from "node:test";
import { buildAlignedLyrics } from "./build-aligned-lyrics";

test("maps the provider's section-prefixed first word without shifting later lines", () => {
  const result = buildAlignedLyrics("[Verse]\nWaggin' tail\nAll night", [
    { word: "[Verse]\nWaggin'", startS: 1.36 },
    { word: "tail", startS: 1.79 },
    { word: "All", startS: 2.5 },
    { word: "night", startS: 2.9 },
  ]);

  assert.deepEqual(result, [
    { text: "[Verse]", start: 1.36, isSection: true },
    { text: "Waggin' tail", start: 1.36, isSection: false },
    { text: "All night", start: 2.5, isSection: false },
  ]);
});

test("ignores standalone aligned section markers and preserves lyric line structure", () => {
  const result = buildAlignedLyrics("\r\n [Chorus] \r\n Hold on \r\n\r\n Stay close \r\n", [
    { word: "[Chorus]", startS: 0 },
    { word: "Hold", startS: 4.2 },
    { word: "on", startS: 4.6 },
    { word: "Stay", startS: 5.1 },
    { word: "close", startS: 5.5 },
  ]);

  assert.deepEqual(result, [
    { text: "[Chorus]", start: 4.2, isSection: true },
    { text: "Hold on", start: 4.2, isSection: false },
    { text: "Stay close", start: 5.1, isSection: false },
  ]);
});

test("falls back safely for empty input and unavailable timestamps", () => {
  assert.deepEqual(buildAlignedLyrics(" \n ", []), []);
  assert.deepEqual(buildAlignedLyrics("[Outro]\nLast line", []), [
    { text: "[Outro]", start: 0, isSection: true },
    { text: "Last line", start: 0, isSection: false },
  ]);
});
