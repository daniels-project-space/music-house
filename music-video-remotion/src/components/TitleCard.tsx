import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

interface TitleCardProps {
  title: string;
  artist: string;
  accentColor: string;
  titleFontFamily: string;
  bodyFontFamily: string;
}

const INTRO_HOLD = 60;  // frames to hold fully visible
const FADE_IN_END = 20; // frames to fade in
const FADE_OUT_START = INTRO_HOLD + FADE_IN_END;
const FADE_OUT_END = FADE_OUT_START + 30; // 1s fade out

export const TitleCard: React.FC<TitleCardProps> = ({
  title,
  artist,
  accentColor,
  titleFontFamily,
  bodyFontFamily,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // After fade-out, render nothing
  if (frame >= FADE_OUT_END) return null;

  const opacity = interpolate(
    frame,
    [0, FADE_IN_END, FADE_OUT_START, FADE_OUT_END],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const titleSlide = interpolate(
    frame,
    [0, FADE_IN_END],
    [40, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const artistSlide = interpolate(
    frame,
    [8, FADE_IN_END + 8],
    [30, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20,
        background: `radial-gradient(ellipse 60% 50% at 50% 50%, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 100%)`,
        opacity,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          transform: `translateY(${titleSlide}px)`,
        }}
      >
        {/* Decorative line above */}
        <div
          style={{
            width: 120,
            height: 2,
            background: accentColor,
            opacity: 0.8,
            marginBottom: 8,
          }}
        />
        <div
          style={{
            fontFamily: titleFontFamily,
            fontSize: 96,
            fontWeight: 900,
            color: "#ffffff",
            letterSpacing: "0.04em",
            textShadow: `0 4px 32px rgba(0,0,0,0.9), 0 0 60px ${accentColor}44`,
            textAlign: "center",
            lineHeight: 1.05,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: bodyFontFamily,
            fontSize: 32,
            fontWeight: 400,
            color: accentColor,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            textShadow: `0 2px 16px rgba(0,0,0,0.9)`,
            transform: `translateY(${artistSlide}px)`,
          }}
        >
          {artist}
        </div>
        {/* Decorative line below */}
        <div
          style={{
            width: 80,
            height: 1,
            background: accentColor,
            opacity: 0.5,
            marginTop: 8,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
