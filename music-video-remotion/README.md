# Music Video Remotion — Dark Vinyl Studio

A Remotion v4 music video composition with a spinning vinyl disc, audio-reactive circular waveform, and karaoke lyrics.

## Setup

1. Place assets under `public/assets/`:
   - `cover.jpg` — album cover (square recommended, ~800×800)
   - `audio.mp3` — full track audio
   - `bg.jpg` — optional background image (blurred/darkened)

2. Install dependencies (from the `music-video-remotion/` directory):
   ```bash
   npm install
   ```
   Chromium will be downloaded automatically by Remotion.

## Render

```bash
npx remotion render VinylMusicVideo out.mp4 --props=./sample-props.json
```

Or with custom props file:
```bash
npx remotion render VinylMusicVideo out.mp4 --props=./props.json
```

## Studio (live preview)

```bash
npm run studio
# opens http://localhost:3000
```

## Props shape

```ts
{
  title: string;           // Track title shown in intro card
  artist: string;          // Artist name
  coverSrc: string;        // "assets/cover.jpg"  (relative to public/)
  audioSrc: string;        // "assets/audio.mp3"
  bgSrc?: string;          // optional "assets/bg.jpg"
  accentColor: string;     // e.g. "#E8B84B"
  fps: number;             // 30 recommended
  durationInFrames: number;// fps × seconds (e.g. 1800 = 60s at 30fps)
  lyrics: Array<{
    text: string;
    start: number;         // seconds
    end: number;           // seconds
    isSection?: boolean;   // renders as dimmed section divider
  }>;
}
```

## Notes

- Requires Chromium (bundled by Remotion on first install).
- Audio-reactive waveform uses `@remotion/media-utils` — audio must be served from `public/` via `staticFile()`.
- Fonts loaded via `@remotion/google-fonts` (Poppins + Anton) — no external CDN needed.
