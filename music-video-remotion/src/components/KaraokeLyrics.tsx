import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { TimedLine } from "../types";

interface KaraokeLyricsProps {
  lyrics: TimedLine[];
  accentColor: string;
  fontFamily: string;
}

const LINE_HEIGHT = 72;
const ACTIVE_SIZE = 52;
const NEIGHBOR_SIZE = 36;
const FAR_SIZE = 28;

export const KaraokeLyrics: React.FC<KaraokeLyricsProps> = ({
  lyrics,
  accentColor,
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  if (!lyrics || lyrics.length === 0) return null;

  const t = frame / fps;

  // Find the active line index: last lyric line whose start <= t
  let activeIdx = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].start <= t) {
      activeIdx = i;
    }
  }

  // Render a window of lines centered on active
  const WINDOW = 5; // how many lines around active to render
  const startIdx = Math.max(0, activeIdx - WINDOW);
  const endIdx = Math.min(lyrics.length - 1, activeIdx + WINDOW);

  // Smooth translateY: interpolate between active line positions
  // Each line occupies LINE_HEIGHT px
  const centerY = height * 0.72; // lower third center
  const targetTranslateY = activeIdx >= 0 ? -activeIdx * LINE_HEIGHT : 0;
  const translateY = interpolate(
    frame,
    activeIdx >= 0
      ? [
          Math.max(0, (lyrics[activeIdx]?.start ?? 0) * fps - 10),
          Math.max(0, (lyrics[activeIdx]?.start ?? 0) * fps + 20),
        ]
      : [0, 1],
    [targetTranslateY, targetTranslateY],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        pointerEvents: "none",
        zIndex: 6,
        paddingBottom: 120,
        overflow: "hidden",
      }}
    >
      {/* Gradient mask so lines fade top/bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: 0,
          right: 0,
          height: LINE_HEIGHT * (WINDOW * 2 + 1),
          maskImage:
            "linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            transform: `translateY(${translateY}px)`,
            transition: "none",
          }}
        >
          {lyrics.map((line, i) => {
            const diff = i - activeIdx;
            const isActive = diff === 0 && !line.isSection;
            const isSection = line.isSection === true;

            let fontSize = FAR_SIZE;
            let opacity = 0.25;
            let color = "#ffffff";
            let textShadow = "none";
            let fontWeight: React.CSSProperties["fontWeight"] = 400;

            if (isSection) {
              fontSize = 20;
              opacity = 0.35;
              color = "#aaaaaa";
              fontWeight = 600;
              textShadow = "none";
            } else if (isActive) {
              fontSize = ACTIVE_SIZE;
              opacity = 1;
              color = accentColor;
              fontWeight = 700;
              textShadow = `0 0 8px ${accentColor}99, 0 2px 4px rgba(0,0,0,0.8)`;
            } else if (Math.abs(diff) === 1) {
              fontSize = NEIGHBOR_SIZE;
              opacity = 0.65;
              fontWeight = 500;
            } else if (Math.abs(diff) === 2) {
              fontSize = FAR_SIZE + 4;
              opacity = 0.4;
            } else {
              fontSize = FAR_SIZE;
              opacity = 0.2;
            }

            return (
              <div
                key={i}
                style={{
                  height: LINE_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize,
                  fontFamily,
                  fontWeight,
                  color,
                  opacity,
                  textShadow,
                  letterSpacing: isSection ? "0.2em" : "0.01em",
                  textTransform: isSection ? "uppercase" : "none",
                  whiteSpace: "nowrap",
                  padding: "0 80px",
                  textAlign: "center",
                  maxWidth: width - 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  transition: "none",
                }}
              >
                {isSection ? `— ${line.text} —` : line.text}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
