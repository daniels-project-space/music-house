import React from "react";
import { useCurrentFrame, useVideoConfig, Img } from "remotion";

interface VinylDiscProps {
  accentColor: string;
  coverSrc: string;      // for the label circular crop
  // Center of disc in px from left, top of the composition
  cx: number;
  cy: number;
  size: number;          // diameter in px
}

export const VinylDisc: React.FC<VinylDiscProps> = ({
  accentColor,
  coverSrc,
  cx,
  cy,
  size,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const radius = size / 2;
  // 1 revolution every 3 seconds — fast, obvious spin
  const rotation = (frame / (fps * 3)) * 360;

  const labelR = radius * 0.235;   // ~75px on 640 disc
  const holeR  = radius * 0.028;

  // Unique IDs scoped to avoid SVG defs collision if ever two comps render
  const ids = {
    body: "vd-body",
    sheen: "vd-sheen",
    discClip: "vd-disc-clip",
    labelClip: "vd-label-clip",
  };

  return (
    <div
      style={{
        position: "absolute",
        left: cx - radius,
        top: cy - radius,
        width: size,
        height: size,
        borderRadius: "50%",
        transform: `rotate(${rotation}deg)`,
        transformOrigin: "center center",
        zIndex: 1,
        pointerEvents: "none",
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: "block", position: "absolute", left: 0, top: 0 }}
      >
        <defs>
          <radialGradient id={ids.body} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1c1c1c" />
            <stop offset="100%" stopColor="#080808" />
          </radialGradient>

          {/* Rotating angular sheen — conic-gradient would be ideal but SVG
              uses a linear gradient wedge that rotates with the disc */}
          <linearGradient id={ids.sheen} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="rgba(255,255,255,0.00)" />
            <stop offset="38%"  stopColor="rgba(255,255,255,0.11)" />
            <stop offset="52%"  stopColor="rgba(255,255,255,0.18)" />
            <stop offset="65%"  stopColor="rgba(255,255,255,0.07)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.00)" />
          </linearGradient>

          <clipPath id={ids.discClip}>
            <circle cx={radius} cy={radius} r={radius} />
          </clipPath>
          <clipPath id={ids.labelClip}>
            <circle cx={radius} cy={radius} r={labelR} />
          </clipPath>
        </defs>

        {/* Base disc body */}
        <circle cx={radius} cy={radius} r={radius} fill={`url(#${ids.body})`} />

        {/* Concentric groove rings */}
        {Array.from({ length: 32 }, (_, i) => {
          const r = radius * 0.26 + (radius * 0.72) * ((i + 1) / 33);
          return (
            <circle
              key={i}
              cx={radius}
              cy={radius}
              r={r}
              fill="none"
              stroke={i % 4 === 0 ? "rgba(255,255,255,0.055)" : "rgba(255,255,255,0.02)"}
              strokeWidth={i % 4 === 0 ? 1.8 : 0.9}
            />
          );
        })}

        {/* Outer rim gloss */}
        <circle
          cx={radius}
          cy={radius}
          r={radius - 2}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={5}
        />

        {/* Rotating sheen wedge — gives clear motion cue */}
        <rect
          x={0}
          y={0}
          width={size}
          height={size}
          fill={`url(#${ids.sheen})`}
          clipPath={`url(#${ids.discClip})`}
        />
      </svg>

      {/* Center label: circular crop of coverSrc via border-radius + overflow */}
      <div
        style={{
          position: "absolute",
          left: radius - labelR,
          top: radius - labelR,
          width: labelR * 2,
          height: labelR * 2,
          borderRadius: "50%",
          overflow: "hidden",
          zIndex: 2,
        }}
      >
        <Img
          src={coverSrc}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        {/* Slight dark ring around label edge */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            boxShadow: "inset 0 0 8px rgba(0,0,0,0.7)",
          }}
        />
      </div>

      {/* Center spindle hole — on top of label */}
      <div
        style={{
          position: "absolute",
          left: radius - holeR,
          top: radius - holeR,
          width: holeR * 2,
          height: holeR * 2,
          borderRadius: "50%",
          background: "#000",
          zIndex: 3,
        }}
      />
    </div>
  );
};
