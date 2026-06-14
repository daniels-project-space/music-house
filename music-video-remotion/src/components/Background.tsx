import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, Img, interpolate } from "remotion";

interface BackgroundProps {
  accentColor: string;
  bgSrc?: string;
  waveform?: number[];
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

// ── Ember/spark motes ─────────────────────────────────────────────────────────
// 24 larger warm glowing dots, rising upward, beat-reactive — NO blur
const _emberRand = seededRand(313);
const EMBERS = Array.from({ length: 24 }, (_, i) => ({
  xFrac:      _emberRand(),
  yFrac:      _emberRand(),
  baseSize:   4.5 + _emberRand() * 5.5,    // 4.5–10px (much larger than dust)
  speedY:     0.22 + _emberRand() * 0.38,  // px/frame upward (faster than dust)
  driftX:     18  + _emberRand() * 28,     // horizontal sway amplitude
  driftPeriod:200 + _emberRand() * 300,
  driftPhase: _emberRand() * Math.PI * 2,
  baseOpacity:0.30 + _emberRand() * 0.40,  // 0.30–0.70 (brighter than dust)
  // warm tint: amber/orange/rose per ember
  hue: i % 3,  // 0=amber, 1=orange-red, 2=rose
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

export const Background: React.FC<BackgroundProps> = ({ accentColor, bgSrc, waveform = [] }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  // ── Beat amplitude from pre-computed waveform ──────────────────────────────
  const amp = waveform.length ? (waveform[Math.min(frame, waveform.length - 1)] ?? 0) : 0;
  // Emphasize larger beats: small fluctuations barely move, big hits clearly bounce
  const beat = Math.pow(amp, 1.6);
  // Smoothed beat for the aurora blobs — averaged over a window so they swell
  // GENTLY rather than flashing on every transient (the flashing was distracting).
  let _acc = 0;
  let _cnt = 0;
  for (let k = frame - 6; k <= frame + 6; k++) {
    if (k >= 0 && k < waveform.length) { _acc += waveform[k]; _cnt++; }
  }
  const smoothBeat = Math.pow(_cnt ? _acc / _cnt : amp, 1.7);

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
        const baseDriftScale = blob.scaleMin + breathe * (1.0 - blob.scaleMin);

        // Per-blob beat phase offset: each blob responds slightly differently
        const blobBeatPhase = 0.7 + 0.3 * ((i * 0.37) % 1);
        const blobBeat = smoothBeat * blobBeatPhase;

        // Beat adds only a SMALL, smooth scale swell on top of the slow drift
        const scale = baseDriftScale * (1 + blobBeat * 0.12);
        const rx = blob.rx * scale;
        const ry = blob.ry * scale;

        // Steady opacity — NO beat flash (was distracting)
        const blobOpacity = blob.opacity;

        let color: string;
        if (blob.kind === 0) {
          color = `rgba(${ar},${ag},${ab},${blobOpacity.toFixed(3)})`;
        } else if (blob.kind === 1) {
          color = `rgba(30,50,140,${(blobOpacity * 1.1).toFixed(3)})`;
        } else {
          color = `rgba(80,30,120,${blobOpacity.toFixed(3)})`;
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

      {/* === 24 Ember/spark motes — larger warm glowing dots, beat-reactive === */}
      {EMBERS.map((e, i) => {
        // Rising wrap: same pattern as dust but faster
        const riseOffset = (e.speedY * frame) % height;
        const rawY = e.yFrac * height - riseOffset;
        const cy = ((rawY % height) + height) % height;
        const cx = e.xFrac * width + Math.sin(frame / e.driftPeriod * Math.PI * 2 + e.driftPhase) * e.driftX;

        // Per-ember beat phase offset for variety
        const emberBeatPhase = 0.65 + 0.35 * ((i * 0.53) % 1);
        const emberBeat = beat * emberBeatPhase;

        // Beat boosts size and opacity
        const size = e.baseSize * (1 + emberBeat * 0.8);
        const opacity = Math.min(e.baseOpacity * (1 + emberBeat), 1.0);

        // Warm accent tints: amber, orange-red, rose
        let emberColor: string;
        if (e.hue === 0) {
          emberColor = `rgba(255,200,80,${opacity.toFixed(3)})`;   // amber
        } else if (e.hue === 1) {
          emberColor = `rgba(255,120,60,${opacity.toFixed(3)})`;   // orange-red
        } else {
          emberColor = `rgba(255,100,160,${opacity.toFixed(3)})`;  // rose
        }

        // Glowing radial-gradient dot (NOT a blur — just a gradient from color→transparent)
        const glowColor = emberColor.replace(/,[^,)]+\)$/, `,${(opacity * 0.25).toFixed(3)})`);

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cx - size * 1.5,
              top:  cy - size * 1.5,
              width:  size * 3,
              height: size * 3,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${emberColor} 0%, ${glowColor} 40%, transparent 75%)`,
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
