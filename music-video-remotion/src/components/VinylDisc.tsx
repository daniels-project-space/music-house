import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

interface VinylDiscProps {
  accentColor: string;
  // Center of disc in px from left, top of the composition
  cx: number;
  cy: number;
  size: number; // diameter in px
}

export const VinylDisc: React.FC<VinylDiscProps> = ({ accentColor, cx, cy, size }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const radius = size / 2;
  // 1 revolution every 4 seconds
  const rotation = (frame / (fps * 4)) * 360;

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
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: "block" }}
      >
        <defs>
          {/* Groove rings via repeating-radial-gradient approximated as SVG circles */}
          <radialGradient id="vinyl-body" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1a1a1a" />
            <stop offset="100%" stopColor="#0a0a0a" />
          </radialGradient>

          {/* Sheen highlight */}
          <radialGradient id="vinyl-sheen" cx="35%" cy="30%" r="60%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>

          {/* Center label gradient */}
          <radialGradient id="vinyl-label" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={accentColor} stopOpacity="0.9" />
            <stop offset="60%" stopColor={accentColor} stopOpacity="0.7" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.85" />
          </radialGradient>

          <clipPath id="disc-clip">
            <circle cx={radius} cy={radius} r={radius} />
          </clipPath>
        </defs>

        {/* Base disc */}
        <circle cx={radius} cy={radius} r={radius} fill="url(#vinyl-body)" />

        {/* Groove rings */}
        {Array.from({ length: 28 }, (_, i) => {
          const r = radius * 0.22 + (radius * 0.76) * ((i + 1) / 29);
          return (
            <circle
              key={i}
              cx={radius}
              cy={radius}
              r={r}
              fill="none"
              stroke={i % 3 === 0 ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.018)"}
              strokeWidth={i % 3 === 0 ? 1.5 : 0.8}
            />
          );
        })}

        {/* Center label */}
        <circle cx={radius} cy={radius} r={radius * 0.2} fill="url(#vinyl-label)" />

        {/* Center hole */}
        <circle cx={radius} cy={radius} r={radius * 0.025} fill="#000" />

        {/* Sheen */}
        <circle cx={radius} cy={radius} r={radius} fill="url(#vinyl-sheen)" clipPath="url(#disc-clip)" />

        {/* Outer rim gloss ring */}
        <circle
          cx={radius}
          cy={radius}
          r={radius - 3}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={4}
        />
      </svg>
    </div>
  );
};
