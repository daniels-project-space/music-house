import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useAudioData, visualizeAudio } from "@remotion/media-utils";
// visualizeAudio v4 returns number[] of amplitudes 0..1

interface CircularWaveformProps {
  audioSrc: string;
  accentColor: string;
  // Center in px from composition left/top
  cx: number;
  cy: number;
  // Inner radius where bars start (just outside cover edge)
  innerRadius: number;
  maxBarHeight: number;
  numBars?: number;
}

export const CircularWaveform: React.FC<CircularWaveformProps> = ({
  audioSrc,
  accentColor,
  cx,
  cy,
  innerRadius,
  maxBarHeight,
  numBars = 96,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const audioData = useAudioData(audioSrc);

  // If audio not yet decoded render flat thin ring
  const amplitudes: number[] = audioData
    ? visualizeAudio({
        frame,
        fps,
        audioData,
        numberOfSamples: 256,
        smoothing: true,
      }).slice(0, numBars)
    : Array(numBars).fill(0.01);

  const angleStep = (2 * Math.PI) / numBars;

  // Parse accentColor for gradient stop (assume hex)
  const hexToRgb = (hex: string) => {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `${r},${g},${b}`;
  };
  const accentRgb = hexToRgb(accentColor.startsWith("#") ? accentColor : "#E8B84B");

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", left: 0, top: 0, zIndex: 3, pointerEvents: "none" }}
    >
      <defs>
        <linearGradient id="bar-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`rgba(${accentRgb},1)`} />
          <stop offset="100%" stopColor={`rgba(${accentRgb},0.3)`} />
        </linearGradient>
      </defs>
      {amplitudes.map((amp, i) => {
        const angle = angleStep * i - Math.PI / 2;
        const barHeight = Math.max(3, amp * maxBarHeight);
        const x1 = cx + Math.cos(angle) * innerRadius;
        const y1 = cy + Math.sin(angle) * innerRadius;
        const x2 = cx + Math.cos(angle) * (innerRadius + barHeight);
        const y2 = cy + Math.sin(angle) * (innerRadius + barHeight);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="url(#bar-gradient)"
            strokeWidth={3.2}
            strokeLinecap="round"
            opacity={0.85 + amp * 0.15}
          />
        );
      })}
    </svg>
  );
};
