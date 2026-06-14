import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, Img, interpolate } from "remotion";

interface BackgroundProps {
  accentColor: string;
  bgSrc?: string;
}

// Seeded deterministic pseudo-random for stable positions (NO Math.random)
function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── Aurora blobs ──────────────────────────────────────────────────────────────
// 7 large soft radial-gradient blobs; each drifts on its own sine/cos path
const _blobRand = seededRand(77);
const BLOBS = Array.from({ length: 7 }, (_, i) => ({
  xFrac:   _blobRand(),
  yFrac:   _blobRand(),
  rx:      300 + _blobRand() * 340,   // semi-axes for elongated ellipses
  ry:      220 + _blobRand() * 280,
  driftX:  50  + _blobRand() * 110,   // drift amplitude in px
  driftY:  35  + _blobRand() * 80,
  periodX: 600 + _blobRand() * 800,   // drift period in frames (600-1400)
  periodY: 700 + _blobRand() * 700,
  phaseX:  _blobRand() * Math.PI * 2,
  phaseY:  _blobRand() * Math.PI * 2,
  scaleMin:0.88 + _blobRand() * 0.06,
  scalePeriod: 800 + _blobRand() * 600,
  scalePhase:  _blobRand() * Math.PI * 2,
  opacity: 0.10 + _blobRand() * 0.08,
  // Colour palette: accent-tinted, deep blues, violets
  kind: i % 3,  // 0=accent, 1=deep-blue, 2=violet
}));

// ── Dust particles ────────────────────────────────────────────────────────────
// 35 tiny dots, deterministic from index
const _dustRand = seededRand(199);
const DUST = Array.from({ length: 35 }, (_, i) => ({
  xFrac:   _dustRand(),
  yFrac:   _dustRand(),
  size:    1.2 + _dustRand() * 2.4,
  speedY:  0.08 + _dustRand() * 0.18,  // px per frame (upward drift)
  driftX:  8   + _dustRand() * 18,     // horizontal sway amplitude
  driftPeriod: 300 + _dustRand() * 400,
  driftPhase:  _dustRand() * Math.PI * 2,
  opacity: 0.08 + _dustRand() * 0.14,
}));

export const Background: React.FC<BackgroundProps> = ({ accentColor, bgSrc }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  // Parse accentColor hex → rgb
  const hex = accentColor.replace("#", "");
  const ar = parseInt(hex.substring(0, 2), 16) || 232;
  const ag = parseInt(hex.substring(2, 4), 16) || 184;
  const ab = parseInt(hex.substring(4, 6), 16) || 75;

  // Slow base gradient hue drift
  const gradProgress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const stop1 = interpolate(gradProgress, [0, 0.5, 1], [0, 22, 10]);
  const stop2 = interpolate(gradProgress, [0, 0.5, 1], [38, 58, 44]);

  // Ken-Burns on bgSrc
  const kbScale = interpolate(frame, [0, durationInFrames], [1.04, 1.12], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const kbTx    = interpolate(frame, [0, durationInFrames], [0, -28],     { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const kbTy    = interpolate(frame, [0, durationInFrames], [0, -18],     { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: "#060608" }}>

      {/* === Evolving multi-stop base gradient === */}
      <AbsoluteFill
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 20% 80%, rgba(${ar},${ag},${ab},0.20) ${stop1}%, transparent ${stop2}%),
            radial-gradient(ellipse 60% 50% at 75% 20%, rgba(40,20,80,0.30) 0%, transparent 55%),
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
              opacity: 0.20,
              transform: `scale(${kbScale}) translate(${kbTx}px, ${kbTy}px)`,
              transformOrigin: "center center",
            }}
          />
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

      {/* === 7 Aurora blobs — large soft radial-gradient ellipses, NO filter === */}
      {BLOBS.map((blob, i) => {
        const cx = blob.xFrac * width  + Math.sin(frame / blob.periodX * Math.PI * 2 + blob.phaseX) * blob.driftX;
        const cy = blob.yFrac * height + Math.cos(frame / blob.periodY * Math.PI * 2 + blob.phaseY) * blob.driftY;
        const breathe = 0.5 + 0.5 * Math.sin(frame / blob.scalePeriod * Math.PI * 2 + blob.scalePhase);
        const scale = blob.scaleMin + breathe * (1.0 - blob.scaleMin);
        const rx = blob.rx * scale;
        const ry = blob.ry * scale;

        let color: string;
        if (blob.kind === 0) {
          color = `rgba(${ar},${ag},${ab},${blob.opacity.toFixed(3)})`;
        } else if (blob.kind === 1) {
          color = `rgba(30,50,140,${(blob.opacity * 1.1).toFixed(3)})`;
        } else {
          color = `rgba(80,30,120,${blob.opacity.toFixed(3)})`;
        }

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cx - rx,
              top:  cy - ry,
              width:  rx * 2,
              height: ry * 2,
              borderRadius: "50%",
              background: `radial-gradient(ellipse, ${color} 0%, transparent 70%)`,
              pointerEvents: "none",
            }}
          />
        );
      })}

      {/* === 35 Dust particles — tiny rising dots, deterministic === */}
      {DUST.map((d, i) => {
        // Rising wrap: particle starts at yFrac * height, drifts UP, wraps
        const totalFrames = Math.max(durationInFrames, 1);
        const riseOffset = (d.speedY * frame) % height;
        const rawY = d.yFrac * height - riseOffset;
        const cy = ((rawY % height) + height) % height;  // wrap 0..height
        const cx = d.xFrac * width + Math.sin(frame / d.driftPeriod * Math.PI * 2 + d.driftPhase) * d.driftX;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cx - d.size / 2,
              top:  cy - d.size / 2,
              width:  d.size,
              height: d.size,
              borderRadius: "50%",
              background: `rgba(255,255,255,${d.opacity.toFixed(3)})`,
              pointerEvents: "none",
            }}
          />
        );
      })}

      {/* === Vignette — dark edges, lighter on left-center (album area) === */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background: `
            radial-gradient(ellipse 110% 100% at 30% 45%, transparent 40%, rgba(0,0,0,0.28) 70%, rgba(0,0,0,0.58) 100%)
          `,
        }}
      />
    </AbsoluteFill>
  );
};
