import React from "react";
import { Composition } from "remotion";
import { VinylMusicVideo } from "./VinylMusicVideo";
import type { VinylMusicVideoProps } from "./types";

const SAMPLE: VinylMusicVideoProps = {
  title: "A Dying Art",
  artist: "Music House Records",
  coverSrc: "https://example.com/cover.jpg",
  audioSrc: "https://example.com/audio.mp3",
  bgSrc: undefined,
  accentColor: "#E8B84B",
  fps: 30,
  durationInFrames: 1800,
  lyrics: [
    { text: "Verse 1", start: 3, end: 5, isSection: true },
    { text: "In the late-night hours I find my way", start: 5, end: 9 },
    { text: "Through the vinyl static the needle sways", start: 9, end: 13 },
    { text: "Every groove a memory carved in black", start: 13, end: 17 },
    { text: "A dying art that keeps pulling me back", start: 17, end: 22 },
    { text: "Chorus", start: 22, end: 24, isSection: true },
    { text: "Spin it round let the music play", start: 24, end: 28 },
    { text: "Dust and gold on a smoky stage", start: 28, end: 32 },
    { text: "Midnight soul in an amber haze", start: 32, end: 36 },
    { text: "A dying art and it's here to stay", start: 36, end: 42 },
    { text: "Verse 2", start: 42, end: 44, isSection: true },
    { text: "Crackle hiss as the platter spins", start: 44, end: 48 },
    { text: "Every record a world that begins", start: 48, end: 52 },
    { text: "Analog warmth that the digital lacks", start: 52, end: 56 },
    { text: "A dying art and it never looks back", start: 56, end: 61 },
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="VinylMusicVideo"
      component={VinylMusicVideo}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={SAMPLE}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.durationInFrames,
        fps: props.fps,
      })}
    />
  );
};
