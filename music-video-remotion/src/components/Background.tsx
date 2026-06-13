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

export const Background: React.FC<BackgroundProps> = ({ accentColor, bgSrc }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // Film grain seed per frame
  const grainSeed = frame * 1234567;

  // Bokeh orbs: 4 slow-breathing blobs
  const rand = seededRand(42);
  const orbs = Array.from({ length: 4 }, (_, i) => ({
    x: rand() * width,
    y: rand() * height,
    r: 180 + rand() * 220,
    speed: 0.003 + rand() * 0.004,
    phase: rand() * Math.PI * 2,
    hue: i % 2 === 0 ? accentColor : "#4B3FA8",
    opacity: 0.07 + rand() * 0.06,
  }));

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* Optional bg image */}
      {bgSrc && (
        <AbsoluteFill>
          <Img
            src={bgSrc}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "blur(18px) brightness(0.25)",
              transform: "scale(1.08)",
            }}
          />
        </AbsoluteFill>
      )}

      {/* Radial spotlight glow from center */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 55% 45% at 48% 46%, ${accentColor}18 0%, transparent 70%)`,
        }}
      />

      {/* Bokeh orbs */}
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <svg width={width} height={height} style={{ position: "absolute" }}>
          {orbs.map((orb, i) => {
            const breathe = Math.sin(frame * orb.speed + orb.phase);
            const cx = orb.x + breathe * 30;
            const cy = orb.y + Math.cos(frame * orb.speed * 0.7 + orb.phase) * 20;
            const scale = 1 + breathe * 0.15;
            return (
              <ellipse
                key={i}
                cx={cx}
                cy={cy}
                rx={orb.r * scale}
                ry={orb.r * 0.85 * scale}
                fill={orb.hue}
                opacity={orb.opacity + breathe * 0.02}
                style={{ filter: "blur(60px)", mixBlendMode: "screen" }}
              />
            );
          })}
        </svg>
      </AbsoluteFill>

      {/* Film grain overlay via SVG feTurbulence */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <svg width={width} height={height} style={{ position: "absolute", opacity: 0.045 }}>
          <filter id={`grain-${frame % 4}`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.85"
              numOctaves="4"
              seed={grainSeed % 999}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect
            width="100%"
            height="100%"
            filter={`url(#grain-${frame % 4})`}
          />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
