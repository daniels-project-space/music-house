import assert from "node:assert/strict";
import test from "node:test";
import { buildAlignedLyrics } from "./build-aligned-lyrics";

test("maps the provider's section-prefixed word shape", () => {
  assert.deepEqual(
    buildAlignedLyrics("[Verse]\nWaggin' tails\nIn the sun", [
      { word: "[Verse]\nWaggin'", startS: 1.36 },
      { word: "tails", startS: 1.79 },
      { word: "In", startS: 3.2 },
      { word: "the", startS: 3.5 },
      { word: "sun", startS: 3.8 },
    ]),
    [
      { text: "[Verse]", start: 1.36, isSection: true },
      { text: "Waggin' tails", start: 1.36, isSection: false },
      { text: "In the sun", start: 3.2, isSection: false },
    ],
  );
});

test("does not shift later lines when Suno omits a lyric token", () => {
  const lines = buildAlignedLyrics("Alpha beta\nGamma delta", [
    { word: "Alpha", startS: 1 },
    { word: "Gamma", startS: 5 },
    { word: "delta", startS: 6 },
  ]);

  assert.deepEqual(lines.map((line) => line.start), [1, 5]);
});

test("does not shift later lines when Suno adds a vocal token", () => {
  const lines = buildAlignedLyrics("One two\nThree four", [
    { word: "One", startS: 1 },
    { word: "uh", startS: 2 },
    { word: "two", startS: 3 },
    { word: "Three", startS: 4 },
    { word: "four", startS: 5 },
  ]);

  assert.deepEqual(lines.map((line) => line.start), [1, 4]);
});

test("interpolates unmatched lines without making the timeline run backward", () => {
  const lines = buildAlignedLyrics("First line\nUnsung words\nLast line\n[Outro]", [
    { word: "First", startS: 2 },
    { word: "line", startS: 3 },
    { word: "Last", startS: 8 },
    { word: "line", startS: 9 },
  ]);

  assert.deepEqual(lines.map((line) => line.start), [2, 5, 8, 8]);
});

test("clamps out-of-order provider anchors to a monotonic line timeline", () => {
  const lines = buildAlignedLyrics("First\nSecond", [
    { word: "First", startS: 5 },
    { word: "Second", startS: 3 },
  ]);

  assert.deepEqual(lines.map((line) => line.start), [5, 5]);
});

test("does not use failed or non-finite provider timestamps as anchors", () => {
  const lines = buildAlignedLyrics("Alpha beta\nGamma", [
    { word: "Alpha", startS: 99, success: false },
    { word: "beta", startS: Number.NaN },
    { word: "Gamma", startS: 7 },
  ]);

  assert.deepEqual(lines.map((line) => line.start), [7, 7]);
});

test("returns the original fallback shape when no words can be aligned", () => {
  assert.deepEqual(buildAlignedLyrics("[Verse]\nHello world", []), [
    { text: "[Verse]", start: 0, isSection: true },
    { text: "Hello world", start: 0, isSection: false },
  ]);
  assert.deepEqual(buildAlignedLyrics(" \n\r\n", []), []);
});
