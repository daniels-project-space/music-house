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

  const renderLine = (
    idx: number,
    isNext: boolean
  ): React.ReactNode => {
    if (idx < 0 || idx >= lyrics.length) return null;
    const line = lyrics[idx];
    const lineDurationFrames = (line.end - line.start) * fps;
    const lineStartFrame = line.start * fps;
    const lineEndFrame   = line.end   * fps;

    // Fade-in: first FADE_IN_FRAMES of line
    const fadeIn = interpolate(
      frame,
      [lineStartFrame, lineStartFrame + FADE_IN_FRAMES],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
    // Fade-out: last FADE_OUT_FRAMES of line
    const fadeOut = interpolate(
      frame,
      [lineEndFrame - FADE_OUT_FRAMES, lineEndFrame],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
    const opacity   = isNext ? fadeIn * 0.38 : Math.min(fadeIn, fadeOut);
    const slideUp   = interpolate(fadeIn, [0, 1], [24, 0]);

    // Left-to-right wipe highlight: a second colored span revealed by clipPath-width trick
    // We do it cheaply: a <span> with accentColor, clipped to a % width = t-progress within line
    const wipeProgress = isNext ? 0 : interpolate(
      frame,
      [lineStartFrame, lineEndFrame],
      [0, 100],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );

    return (
      <div
        key={idx}
        style={{
          position: "relative",
          opacity,
          transform: `translateY(${slideUp}px)`,
          marginBottom: isNext ? 0 : 16,
          lineHeight: 1.2,
          maxWidth: captionW,
          overflow: "hidden",
        }}
      >
        {/* Base white text */}
        <span
          style={{
            display: "block",
            fontFamily,
            fontWeight: isNext ? 500 : 700,
            fontSize: isNext ? 34 : 58,
            color: "rgba(255,255,255,0.95)",
            letterSpacing: "-0.01em",
            textShadow: "0 2px 12px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.8)",
            whiteSpace: "normal",
            wordBreak: "break-word",
          }}
        >
          {line.text}
        </span>

        {/* Accent wipe layer — clip via overflow+width on a positioned span */}
        {!isNext && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: `${wipeProgress}%`,
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
                fontSize: 58,
                color: accentColor,
                letterSpacing: "-0.01em",
                textShadow: `0 0 20px ${accentColor}55, 0 2px 8px rgba(0,0,0,0.7)`,
                whiteSpace: "normal",
                wordBreak: "break-word",
                width: captionW,
              }}
            >
              {line.text}
            </span>
          </span>
        )}
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
      {renderLine(activeIdx, false)}

      {/* Next line (faint preview) */}
      {nextIdx >= 0 && renderLine(nextIdx, true)}
    </div>
  );
};
