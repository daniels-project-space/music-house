import React from "react";
import { Img, useCurrentFrame, useVideoConfig, spring } from "remotion";

interface AlbumCoverProps {
  coverSrc: string;
  cx: number;   // center x in composition
  cy: number;   // center y in composition
  size: number; // px
}

export const AlbumCover: React.FC<AlbumCoverProps> = ({ coverSrc, cx, cy, size }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    from: 0.7,
    to: 1,
    config: { damping: 18, stiffness: 120, mass: 1 },
  });

  const opacity = Math.min(1, frame / 20);

  return (
    <div
      style={{
        position: "absolute",
        left: cx - size / 2,
        top: cy - size / 2,
        width: size,
        height: size,
        zIndex: 4,
        transform: `scale(${scale})`,
        transformOrigin: "center center",
        opacity,
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 8px 16px rgba(0,0,0,0.85), 0 2px 6px rgba(0,0,0,0.6)",
      }}
    >
      <Img
        src={coverSrc}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
    </div>
  );
};
