import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, Img, interpolate } from "remotion";

interface BackgroundProps {
  accentColor: string;
  bgSrc?: string;
}

// Seeded deterministic pseudo-random for stable orb positions
function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const _rand = seededRand(42);
const ORB_BASE = Array.from({ length: 4 }, () => ({
  xFrac: _rand(),
  yFrac: _rand(),
  r: 260 + _rand() * 280,
  speed: 0.002 + _rand() * 0.003,
  phase: _rand() * Math.PI * 2,
  opacity: 0.16 + _rand() * 0.10,
  isAccent: _rand() > 0.45,
}));

export const Background: React.FC<BackgroundProps> = ({ accentColor, bgSrc }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  // Slowly evolving gradient stop offset (0→1 over full duration)
  const gradProgress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Stop position drifts: deep accent glow pulses out from bottom-left
  const stop1 = interpolate(gradProgress, [0, 0.5, 1], [0, 18, 8]);
  const stop2 = interpolate(gradProgress, [0, 0.5, 1], [38, 55, 42]);

  // Ken-Burns on bgSrc: slow drift + very slight scale over duration
  const kbScale  = interpolate(frame, [0, durationInFrames], [1.04, 1.12], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const kbTx     = interpolate(frame, [0, durationInFrames], [0, -28],    { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const kbTy     = interpolate(frame, [0, durationInFrames], [0, -18],    { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Parse accentColor hex to rgb for inline rgba usage
  // Safe fallback: amber
  const hex = accentColor.replace("#", "");
  const ar = parseInt(hex.substring(0, 2), 16) || 232;
  const ag = parseInt(hex.substring(2, 4), 16) || 184;
  const ab = parseInt(hex.substring(4, 6), 16) || 75;

  return (
    <AbsoluteFill style={{ background: "#060608" }}>

      {/* === Evolving multi-stop base gradient === */}
      <AbsoluteFill
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 20% 80%, rgba(${ar},${ag},${ab},0.22) ${stop1}%, transparent ${stop2}%),
            radial-gradient(ellipse 60% 50% at 75% 20%, rgba(60,30,90,0.28) 0%, transparent 55%),
            linear-gradient(160deg, #0a080f 0%, #0e0c14 40%, #08060a 100%)
          `,
        }}
      />

      {/* === Optional bg image with Ken-Burns drift (NO blur) === */}
      {bgSrc && (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <Img
            src={bgSrc}
            style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: 0.22,
              transform: `scale(${kbScale}) translate(${kbTx}px, ${kbTy}px)`,
              transformOrigin: "center center",
            }}
          />
          {/* Dark gradient overlay: keeps foreground readable, clears left-center */}
          <AbsoluteFill
            style={{
              background: `
                linear-gradient(to right, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.72) 100%),
                radial-gradient(ellipse 55% 70% at 32% 45%, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.65) 100%)
              `,
            }}
          />
        </AbsoluteFill>
      )}

      {/* === Floating accent glow orbs — radial-gradient divs, NO filter === */}
      {ORB_BASE.map((orb, i) => {
        const breathe = Math.sin(frame * orb.speed + orb.phase);
        const cx = orb.xFrac * width  + breathe * 40;
        const cy = orb.yFrac * height + Math.cos(frame * orb.speed * 0.7 + orb.phase) * 30;
        const scale = 1 + breathe * 0.12;
        const rx = orb.r * scale;
        const ry = orb.r * 0.85 * scale;
        const color = orb.isAccent
          ? `rgba(${ar},${ag},${ab},${(orb.opacity + breathe * 0.025).toFixed(3)})`
          : `rgba(55,28,105,${(orb.opacity * 0.85 + breathe * 0.02).toFixed(3)})`;
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
              background: `radial-gradient(circle, ${color} 0%, transparent 68%)`,
              pointerEvents: "none",
            }}
          />
        );
      })}

      {/* === Vignette — dark edges, slightly lighter on left-center (album area) === */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background: `
            radial-gradient(ellipse 110% 100% at 30% 45%, transparent 40%, rgba(0,0,0,0.28) 70%, rgba(0,0,0,0.55) 100%)
          `,
        }}
      />
    </AbsoluteFill>
  );
};
