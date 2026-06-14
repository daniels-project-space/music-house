export type TimedLine = {
  text: string;
  start: number; // seconds
  end: number;   // seconds
  isSection?: boolean;
  /** Per-word timings. Each entry's start is in SECONDS. */
  words?: { text: string; start: number }[];
};

export type VinylMusicVideoProps = {
  title: string;
  artist: string;
  coverSrc: string;       // absolute HTTPS URL, e.g. presigned R2 link
  audioSrc: string;       // absolute HTTPS URL, e.g. presigned R2 link
  bgSrc?: string;         // optional background image (absolute HTTPS URL)
  lyrics: TimedLine[];
  accentColor: string;    // e.g. "#E8B84B"
  fps: number;
  durationInFrames: number;
  /**
   * Pre-computed per-frame loudness envelope, length == durationInFrames.
   * Values 0..1. Generated outside Remotion (e.g. ffmpeg/essentia) so the
   * browser does zero audio decoding during render.
   */
  waveform: number[];
};
