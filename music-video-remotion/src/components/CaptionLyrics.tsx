import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { TimedLine } from "../types";

interface CaptionLyricsProps {
  lyrics: TimedLine[];
  accentColor: string;
  fontFamily: string;
}

// Caption area: right 55% of frame, lower third
const CAPTION_LEFT_FRAC = 0.43;  // starts at 43% from left → right of album
const CAPTION_BOTTOM   = 180;    // px from bottom of frame
const CAPTION_MAX_W    = 980;    // max caption width in px

const FADE_IN_FRAMES  = 8;
const FADE_OUT_FRAMES = 6;

// Words light a hair before their onset so the glow lands right as the word is
// sung (whisper onsets sit slightly late); a quick pop keeps it crisp/tight.
const LEAD_SEC = 0.08;
const POP_DURATION = 4; // frames for the pop to settle (snappier than before)

export const CaptionLyrics: React.FC<CaptionLyricsProps> = ({
  lyrics,
  accentColor,
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  if (!lyrics || lyrics.length === 0) return null;

  const t = frame / fps;

  // Active line: last line with isSection!=true where start <= t < end
  let activeIdx = -1;
  for (let i = 0; i < lyrics.length; i++) {
    const line = lyrics[i];
    if (line.isSection) continue;
    if (line.start <= t && t < line.end) {
      activeIdx = i;
      break;
    }
  }

  // Section label: which section are we in right now?
  let sectionLabel: string | null = null;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].isSection && lyrics[i].start <= t) {
      sectionLabel = lyrics[i].text;
    }
  }

  const captionLeft = width * CAPTION_LEFT_FRAC;
  const captionW    = Math.min(CAPTION_MAX_W, width - captionLeft - 48);

  // Next lyric line (non-section, after active)
  let nextIdx = -1;
  if (activeIdx >= 0) {
    for (let i = activeIdx + 1; i < lyrics.length; i++) {
      if (!lyrics[i].isSection) { nextIdx = i; break; }
    }
  }

  const renderActiveLine = (idx: number): React.ReactNode => {
    if (idx < 0 || idx >= lyrics.length) return null;
    const line = lyrics[idx];
    const lineStartFrame = line.start * fps;
    const lineEndFrame   = line.end   * fps;

    const fadeIn = interpolate(
      frame,
      [lineStartFrame, lineStartFrame + FADE_IN_FRAMES],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
    const fadeOut = interpolate(
      frame,
      [lineEndFrame - FADE_OUT_FRAMES, lineEndFrame],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
    const opacity = Math.min(fadeIn, fadeOut);
    const slideUp = interpolate(fadeIn, [0, 1], [24, 0]);

    // Per-word rendering when words are available
    const hasWords = line.words && line.words.length > 0;

    const renderWords = () => {
      if (!line.words) return null;
      return line.words.map((word, wi) => {
        const wordLitFrame = (word.start - LEAD_SEC) * fps;
        const isLit = frame >= wordLitFrame;
        const framesAfterLit = Math.max(0, frame - wordLitFrame);

        // Tight, snappy pop: quick overshoot to ~1.10 then settle by POP_DURATION
        const popScaleFinal = isLit
          ? (() => {
              const pf = Math.min(framesAfterLit, POP_DURATION);
              if (pf < 1.5) return 1 + (pf / 1.5) * 0.1;
              return 1 + interpolate(pf, [1.5, POP_DURATION], [0.1, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
            })()
          : 1.0;

        return (
          <span
            key={wi}
            style={{
              display: "inline-block",
              marginRight: "0.22em",
              color: isLit ? accentColor : "rgba(255,255,255,0.42)",
              textShadow: isLit
                ? `0 0 14px ${accentColor}99, 0 2px 8px rgba(0,0,0,0.8)`
                : "none",
              transform: `scale(${popScaleFinal})`,
              transformOrigin: "bottom center",
              transition: "none",
              fontFamily,
              fontWeight: 700,
              fontSize: 54,
              letterSpacing: "-0.01em",
            }}
          >
            {word.text}
          </span>
        );
      });
    };

    // Fallback: whole line lights up based on [start,end] progress
    const renderWholeLine = () => {
      const litProgress = interpolate(
        frame,
        [lineStartFrame, lineEndFrame],
        [0, 100],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      );
      return (
        <div style={{ position: "relative", overflow: "hidden" }}>
          {/* Base dim text */}
          <span
            style={{
              display: "block",
              fontFamily,
              fontWeight: 700,
              fontSize: 54,
              color: "rgba(255,255,255,0.42)",
              letterSpacing: "-0.01em",
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
          >
            {line.text}
          </span>
          {/* Lit overlay */}
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: `${litProgress}%`,
              overflow: "hidden",
              display: "block",
              whiteSpace: "normal",
              wordBreak: "break-word",
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                display: "block",
                fontFamily,
                fontWeight: 700,
                fontSize: 54,
                color: accentColor,
                letterSpacing: "-0.01em",
                whiteSpace: "normal",
                wordBreak: "break-word",
                width: captionW,
                textShadow: `0 0 14px ${accentColor}88, 0 2px 8px rgba(0,0,0,0.7)`,
              }}
            >
              {line.text}
            </span>
          </span>
        </div>
      );
    };

    return (
      <div
        key={idx}
        style={{
          position: "relative",
          opacity,
          transform: `translateY(${slideUp}px)`,
          marginBottom: 16,
          lineHeight: 1.25,
          maxWidth: captionW,
        }}
      >
        {hasWords ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline" }}>
            {renderWords()}
          </div>
        ) : (
          renderWholeLine()
        )}
      </div>
    );
  };

  const renderNextLine = (idx: number): React.ReactNode => {
    if (idx < 0 || idx >= lyrics.length) return null;
    const line = lyrics[idx];
    const lineStartFrame = line.start * fps;

    const fadeIn = interpolate(
      frame,
      [lineStartFrame, lineStartFrame + FADE_IN_FRAMES],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
    const slideUp = interpolate(fadeIn, [0, 1], [24, 0]);

    return (
      <div
        key={`next-${idx}`}
        style={{
          opacity: fadeIn * 0.38,
          transform: `translateY(${slideUp}px)`,
          lineHeight: 1.25,
          maxWidth: captionW,
          fontFamily,
          fontWeight: 500,
          fontSize: 34,
          color: "rgba(255,255,255,0.95)",
          letterSpacing: "-0.01em",
          textShadow: "0 2px 12px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.8)",
          whiteSpace: "normal",
          wordBreak: "break-word",
        }}
      >
        {line.text}
      </div>
    );
  };

  return (
    <div
      style={{
        position: "absolute",
        left: captionLeft,
        bottom: CAPTION_BOTTOM,
        width: captionW,
        zIndex: 6,
        pointerEvents: "none",
      }}
    >
      {/* Section label — small dim pill above caption */}
      {sectionLabel && (
        <div
          style={{
            fontFamily,
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: `${accentColor}99`,
            marginBottom: 14,
            opacity: 0.75,
          }}
        >
          — {sectionLabel} —
        </div>
      )}

      {/* Active line */}
      {renderActiveLine(activeIdx)}

      {/* Next line (faint preview) */}
      {nextIdx >= 0 && renderNextLine(nextIdx)}
    </div>
  );
};
