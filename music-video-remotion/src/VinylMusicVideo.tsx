import React from "react";
import { AbsoluteFill, Audio } from "remotion";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";

import type { VinylMusicVideoProps } from "./types";
import { Background } from "./components/Background";
import { VinylDisc } from "./components/VinylDisc";
import { CircularWaveform } from "./components/CircularWaveform";
import { AlbumCover } from "./components/AlbumCover";
import { KaraokeLyrics } from "./components/KaraokeLyrics";
import { TitleCard } from "./components/TitleCard";

// Load fonts at module level (Remotion requirement)
const { fontFamily: poppinsFont } = loadPoppins();
const { fontFamily: antonFont } = loadAnton();

// Layout constants
const COMP_W = 1920;
const COMP_H = 1080;

// Cluster center: slightly left of middle, a bit above center
const CLUSTER_CX = COMP_W * 0.46;
const CLUSTER_CY = COMP_H * 0.44;

const COVER_SIZE = 520;       // album cover side length
const DISC_SIZE = 560;        // vinyl disc diameter

// Disc center: shifted right so ~45% of disc pokes out from cover right edge
// Cover right edge = CLUSTER_CX + COVER_SIZE/2 = CLUSTER_CX + 260
// Disc needs ~55% hidden behind cover, 45% visible right
// So disc center = cover right edge - 0.55 * disc_radius = cover right edge - 0.55 * 280 = cover right edge - 154
const DISC_CX = CLUSTER_CX + COVER_SIZE / 2 - DISC_SIZE * 0.05;
const DISC_CY = CLUSTER_CY;

// Waveform: inner radius = just outside cover edge + small gap
const WAVEFORM_INNER_RADIUS = COVER_SIZE / 2 + 18; // 278
const WAVEFORM_MAX_BAR = 55;

export const VinylMusicVideo: React.FC<VinylMusicVideoProps> = (props) => {
  const {
    title,
    artist,
    coverSrc,
    audioSrc,
    bgSrc,
    lyrics,
    accentColor,
  } = props;

  return (
    <AbsoluteFill style={{ background: "#000", width: COMP_W, height: COMP_H }}>
      {/* Audio track */}
      <Audio src={audioSrc} />

      {/* Layer 0: Background (black + glow + bokeh + grain) */}
      <Background accentColor={accentColor} bgSrc={bgSrc} />

      {/* Layer 1: Vinyl disc (behind cover, zIndex 1) */}
      <VinylDisc
        accentColor={accentColor}
        cx={DISC_CX}
        cy={DISC_CY}
        size={DISC_SIZE}
      />

      {/* Layer 2: Circular waveform ring (zIndex 3, centered on cluster) */}
      <CircularWaveform
        audioSrc={audioSrc}
        accentColor={accentColor}
        cx={CLUSTER_CX}
        cy={CLUSTER_CY}
        innerRadius={WAVEFORM_INNER_RADIUS}
        maxBarHeight={WAVEFORM_MAX_BAR}
        numBars={96}
      />

      {/* Layer 3: Album cover (zIndex 4) */}
      <AlbumCover
        coverSrc={coverSrc}
        cx={CLUSTER_CX}
        cy={CLUSTER_CY}
        size={COVER_SIZE}
      />

      {/* Layer 4: Karaoke lyrics lower third (zIndex 6) */}
      <KaraokeLyrics
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
