import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, Img, interpolate } from "remotion";

interface BackgroundProps {
  accentColor: string;
  bgSrc?: string;
}

// Seeded deterministic pseudo-random for stable bokeh positions
function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Hoisted to module level: positions/sizes are constant, only accentColor varies per render
// accentColor is passed in at render time for hue; shape data is stable
const _rand = seededRand(42);
const ORB_BASE = Array.from({ length: 4 }, () => ({
  xFrac: _rand(),
  yFrac: _rand(),
  r: 180 + _rand() * 220,
  speed: 0.003 + _rand() * 0.004,
  phase: _rand() * Math.PI * 2,
  isAccent: _rand() > 0.5,
  opacity: 0.18 + _rand() * 0.12,
}));

export const Background: React.FC<BackgroundProps> = ({ accentColor, bgSrc }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* Optional bg image — no blur, just darken with overlay */}
      {bgSrc && (
        <AbsoluteFill>
          <Img
            src={bgSrc}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: 0.18,
            }}
          />
          {/* Dark overlay to keep bg very subtle */}
          <AbsoluteFill style={{ background: "rgba(0,0,0,0.72)" }} />
        </AbsoluteFill>
      )}

      {/* Radial spotlight glow from center */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 55% 45% at 48% 46%, ${accentColor}18 0%, transparent 70%)`,
        }}
      />

      {/* Bokeh orbs — CSS radial-gradient divs, NO blur filter, NO mixBlendMode */}
      {ORB_BASE.map((orb, i) => {
        const breathe = Math.sin(frame * orb.speed + orb.phase);
        const cx = orb.xFrac * width + breathe * 30;
        const cy = orb.yFrac * height + Math.cos(frame * orb.speed * 0.7 + orb.phase) * 20;
        const scale = 1 + breathe * 0.15;
        const rx = orb.r * scale;
        const ry = orb.r * 0.85 * scale;
        const color = i % 2 === 0 ? accentColor : "#4B3FA8";
        const op = orb.opacity + breathe * 0.02;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cx - rx,
              top: cy - ry,
              width: rx * 2,
              height: ry * 2,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${color}${Math.round(op * 255).toString(16).padStart(2, "0")} 0%, transparent 70%)`,
              opacity: 1,
              pointerEvents: "none",
            }}
          />
        );
      })}

      {/* Film grain removed (feTurbulence per-frame too costly for software raster).
          Replaced with zero-cost static dark vignette overlay. */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background: "radial-gradient(ellipse 100% 100% at 50% 50%, transparent 55%, rgba(0,0,0,0.35) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
