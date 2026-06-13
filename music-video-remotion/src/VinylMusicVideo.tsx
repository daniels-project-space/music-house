import React from "react";
import { AbsoluteFill, Audio } from "remotion";
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

  return (
    <AbsoluteFill style={{ background: "#000", width: COMP_W, height: COMP_H }}>
      {/* Audio track */}
      <Audio src={audioSrc} />

      {/* Layer 0: Rich animated background */}
      <Background accentColor={accentColor} bgSrc={bgSrc} />

      {/* Layer 1: Vinyl disc BEHIND cover — larger, offset right */}
      <VinylDisc
        accentColor={accentColor}
        coverSrc={coverSrc}
        cx={DISC_CX}
        cy={DISC_CY}
        size={DISC_SIZE}
      />

      {/* Layer 2: Bold circular waveform halo around cover */}
      <CircularWaveform
        waveform={waveform}
        accentColor={accentColor}
        cx={COVER_CX}
        cy={COVER_CY}
        innerRadius={WAVEFORM_INNER_RADIUS}
        maxBarHeight={WAVEFORM_MAX_BAR}
        numBars={68}
      />

      {/* Layer 3: Album cover — left side, z above disc */}
      <AlbumCover
        coverSrc={coverSrc}
        cx={COVER_CX}
        cy={COVER_CY}
        size={COVER_SIZE}
      />

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
