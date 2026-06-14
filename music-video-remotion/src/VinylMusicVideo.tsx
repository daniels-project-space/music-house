import React from "react";
import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";

import type { VinylMusicVideoProps } from "./types";
import { Background } from "./components/Background";
import { VinylDisc } from "./components/VinylDisc";
import { CircularWaveform } from "./components/CircularWaveform";
import { AlbumCover } from "./components/AlbumCover";
import { CaptionLyrics } from "./components/CaptionLyrics";
import { TitleCard } from "./components/TitleCard";

// Load fonts at module level (Remotion requirement)
const { fontFamily: poppinsFont } = loadPoppins();
const { fontFamily: antonFont } = loadAnton();

// Layout constants
const COMP_W = 1920;
const COMP_H = 1080;

// Album cluster: left side, center x ~32%, y ~45%
const COVER_CX = COMP_W * 0.32;    // 614px
const COVER_CY = COMP_H * 0.45;    // 486px

const COVER_SIZE = 460;            // album cover square
const DISC_SIZE = 640;             // vinyl disc — bigger, pokes right

// Disc center: offset RIGHT so ~55% of disc sticks out past cover right edge
// Cover right edge = COVER_CX + COVER_SIZE/2 = 614 + 230 = 844
// Disc center x = cover right edge - 0.45 * disc_radius = 844 - 0.45*320 = 844 - 144 = 700
const DISC_CX = COVER_CX + COVER_SIZE / 2 - DISC_SIZE * 0.225;
const DISC_CY = COVER_CY;

// Waveform: bold halo ring around the cluster, centered on cover
const WAVEFORM_INNER_RADIUS = COVER_SIZE / 2 + 24;  // 254
const WAVEFORM_MAX_BAR = 110;                        // much taller bars

export const VinylMusicVideo: React.FC<VinylMusicVideoProps> = (props) => {
  const {
    title,
    artist,
    coverSrc,
    audioSrc,
    bgSrc,
    lyrics,
    accentColor,
    waveform,
  } = props;

  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ── Beat-reactive amplitude (0..1) from pre-computed waveform ──
  const amp = waveform.length
    ? (waveform[Math.min(frame, waveform.length - 1)] ?? 0)
    : 0;

  // Cluster scale: 1.0 + subtle amp push (max ~2.5% scale up)
  const clusterScale = 1 + amp * 0.025;

  // Slow float: album cover gentle bob (~6px over ~180 frames)
  const floatY = Math.sin((frame / 180) * Math.PI * 2) * 6;

  // Background counter-drift for parallax depth
  const bgParallaxX = Math.sin((frame / 240) * Math.PI * 2) * -4;

  // Accent glow ring opacity pulses with amp
  const haloOpacity = 0.08 + amp * 0.22;

  // Slow-rotating halo: conic gradient ring behind vinyl, low opacity
  const haloDeg = (frame / durationInFrames) * 360;

  // Parse accentColor hex → rgb for inline rgba
  const hexStr = accentColor.replace("#", "");
  const ar = parseInt(hexStr.substring(0, 2), 16) || 232;
  const ag = parseInt(hexStr.substring(2, 4), 16) || 184;
  const ab = parseInt(hexStr.substring(4, 6), 16) || 75;

  return (
    <AbsoluteFill style={{ background: "#000", width: COMP_W, height: COMP_H }}>
      {/* Audio track */}
      <Audio src={audioSrc} />

      {/* Layer 0: Rich animated background (counter-parallax) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateX(${bgParallaxX}px)`,
        }}
      >
        <Background accentColor={accentColor} bgSrc={bgSrc} waveform={waveform} />
      </div>

      {/* Beat-reactive cluster wrapper */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${clusterScale})`,
          transformOrigin: `${COVER_CX}px ${COVER_CY}px`,
        }}
      >
        {/* Accent glow ring (z1): pulses with amp, behind disc+cover */}
        <div
          style={{
            position: "absolute",
            left: COVER_CX - COVER_SIZE * 0.6,
            top:  COVER_CY - COVER_SIZE * 0.6,
            width:  COVER_SIZE * 1.2,
            height: COVER_SIZE * 1.2,
            borderRadius: "50%",
            background: `radial-gradient(circle, rgba(${ar},${ag},${ab},${haloOpacity.toFixed(3)}) 0%, transparent 72%)`,
            pointerEvents: "none",
            zIndex: 1,
          }}
        />

        {/* Slow-rotating soft light halo (z1) behind vinyl — conic gradient, NO blur */}
        <div
          style={{
            position: "absolute",
            left: DISC_CX - DISC_SIZE * 0.58,
            top:  DISC_CY - DISC_SIZE * 0.58,
            width:  DISC_SIZE * 1.16,
            height: DISC_SIZE * 1.16,
            borderRadius: "50%",
            background: `conic-gradient(from ${haloDeg}deg, rgba(${ar},${ag},${ab},0.07) 0deg, transparent 120deg, rgba(80,30,180,0.06) 200deg, transparent 300deg, rgba(${ar},${ag},${ab},0.05) 360deg)`,
            pointerEvents: "none",
            zIndex: 1,
          }}
        />

        {/* z2: Vinyl disc BEHIND cover — larger, offset right */}
        <div style={{ position: "absolute", inset: 0, zIndex: 2 }}>
          <VinylDisc accentColor={accentColor} coverSrc={coverSrc} cx={DISC_CX} cy={DISC_CY} size={DISC_SIZE} />
        </div>

        {/* z3: Bold circular waveform halo around cover */}
        <div style={{ position: "absolute", inset: 0, zIndex: 3 }}>
          <CircularWaveform
            waveform={waveform}
            accentColor={accentColor}
            cx={COVER_CX}
            cy={COVER_CY}
            innerRadius={WAVEFORM_INNER_RADIUS}
            maxBarHeight={WAVEFORM_MAX_BAR}
            numBars={68}
          />
        </div>

        {/* z5: Album cover IN FRONT, with gentle float translateY */}
        <div style={{ position: "absolute", inset: 0, zIndex: 5, transform: `translateY(${floatY}px)` }}>
          <AlbumCover coverSrc={coverSrc} cx={COVER_CX} cy={COVER_CY} size={COVER_SIZE} />
        </div>
      </div>

      {/* Layer 4: Caption lyrics — lower right, prominent */}
      <CaptionLyrics
        lyrics={lyrics}
        accentColor={accentColor}
        fontFamily={poppinsFont}
      />

      {/* Layer 5: Footer wordmark */}
      <div
        style={{
          position: "absolute",
          bottom: 36,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: antonFont,
          fontSize: 18,
          fontWeight: 400,
          letterSpacing: "0.35em",
          color: "rgba(255,255,255,0.35)",
          textTransform: "uppercase",
          zIndex: 7,
          pointerEvents: "none",
        }}
      >
        Music House Records
      </div>

      {/* Layer 6: Intro title card (fades out after ~3s) */}
      <TitleCard
        title={title}
        artist={artist}
        accentColor={accentColor}
        titleFontFamily={antonFont}
        bodyFontFamily={poppinsFont}
      />
    </AbsoluteFill>
  );
};
