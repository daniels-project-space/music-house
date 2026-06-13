import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

// Static organic shape multipliers — deterministic, module-level
const NUM_BARS = 68;
const SHAPE: number[] = Array.from(
  { length: NUM_BARS },
  (_, i) => 0.45 + 0.55 * Math.abs(Math.sin(i * 0.83 + 0.4))
);

interface CircularWaveformProps {
  waveform: number[];
  accentColor: string;
  cx: number;
  cy: number;
  innerRadius: number;
  maxBarHeight: number;
  numBars?: number;
}

export const CircularWaveform: React.FC<CircularWaveformProps> = ({
  waveform,
  accentColor,
  cx,
  cy,
  innerRadius,
  maxBarHeight,
  numBars = NUM_BARS,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const amp = waveform.length
    ? (waveform[Math.min(frame, waveform.length - 1)] ?? 0)
    : 0;

  const angleStep = (2 * Math.PI) / numBars;
  const baseLen = 6;
  const maxExtra = maxBarHeight - baseLen;

  // Gradient: accent at inner, fading to transparent at outer tip
  const gradId = "cwv-grad";

  // Build path data for all bars
  const bars = Array.from({ length: numBars }, (_, i) => {
    const shape = SHAPE[i % NUM_BARS] ?? 0.7;
    const barLen = baseLen + amp * maxExtra * shape;
    const angle = angleStep * i - Math.PI / 2;
    const x1 = cx + Math.cos(angle) * innerRadius;
    const y1 = cy + Math.sin(angle) * innerRadius;
    const x2 = cx + Math.cos(angle) * (innerRadius + barLen);
    const y2 = cy + Math.sin(angle) * (innerRadius + barLen);
    return { x1, y1, x2, y2, barLen };
  });

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", left: 0, top: 0, zIndex: 3, pointerEvents: "none" }}
    >
      <defs>
        {/* Radial gradient centered on cluster for accent→transparent bars */}
        <radialGradient id={gradId} cx={cx / width} cy={cy / height} r="0.35" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor={accentColor} stopOpacity="1" />
          <stop offset="60%" stopColor={accentColor} stopOpacity="0.85" />
          <stop offset="100%" stopColor={accentColor} stopOpacity="0.3" />
        </radialGradient>
      </defs>
      {bars.map(({ x1, y1, x2, y2 }, i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={`url(#${gradId})`}
          strokeWidth={4.5}
          strokeLinecap="round"
          opacity={0.88 + amp * 0.12}
        />
      ))}
    </svg>
  );
};
