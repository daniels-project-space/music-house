# Music House Records — Standalone YouTube Music-Video Pipeline

**Status:** PLAN — awaiting Daniel approval before build.
**Date:** 2026-06-13
**Owner repo:** `/home/ubuntu/music-house` (self-contained; NOT part of AutoStudio's block/module pipeline)

---

## 1. Goal (locked decisions)

A dedicated, **non-modular**, gated pipeline: every time a single is released via DistroKid, **+5 days later** a per-song schedule fires that renders an "official audio" music video and (once the channel is connected) uploads it to a **Music House Records** YouTube channel with discovery tags + "listen everywhere" links.

| Decision | Choice |
|---|---|
| Render infra | **Trigger.dev cloud** (large machine; `@remotion/renderer`) |
| Visual style | **Dark vinyl studio** — black bg, spotlit cover, vinyl disc half-out behind cover (spinning), circular audio-reactive waveform ringing the album, large centered karaoke lyrics, "Music House Records" footer |
| Lyric sync | **Forced alignment** (real per-line/word timestamps vs the audio) |
| Demo scope | Render **"A Dying Art"** to R2 for review; **hold** YouTube upload until channel + OAuth exist |
| Channel schedule | **None global.** Each released song creates its OWN scheduled entry (+5d). |

---

## 2. Hard realities (flagged, not hidden)

1. **A YouTube channel cannot be created via API.** "Music House Records" needs a one-time human step: create a **Brand Account** + run OAuth consent. I scaffold the consent script + exact steps; the click is Daniel's.
2. **`tracks.lyrics` timestamps look like all `start:0`** (Suno dump) → unusable for tight sync → forced-alignment step required.
3. **Forced alignment needs an API** (hosted WhisperX on Replicate, or Groq whisper-large-v3 word-timestamps). I will check the vault; if the key is **absent**, I flag it (AeroDataBox-style gap) and fall back to steady-scroll lyrics for the demo only.
4. **"A Dying Art" is currently `distributed:false`** in Convex (job stuck at `draft_ready`) and its **ISRC + store URLs were never written back**. I will NOT touch DistroKid/distribution state (needs Daniel sign-off). The demo uses a **manual invocation** on the existing audio/art, and backfills the verified links onto the track record.

---

## 3. Verified inputs for the demo

- Track `_id`: `js7d0zwgzzhzx7dkek1nvmen7n85y69v` · artist `the-dollcat-club` · album `a-dying-art`
- Audio: R2 key `_suno/mnd4th9v52wl/01_a-dying-art.mp3`
- Cover: track `coverKey` blank → use `albums.coverKey` for album `a-dying-art`
- ISRC: `QT3FE2667534` · released **2026-06-11**
- Links (verified): Apple `…/a-dying-art/6779767416?i=6779767417` · Deezer `track/4083656861` · Tidal `track/532967064` · auto-YT `OdKj1M9dbaU` · universal `song.link/us/i/6779767417` · Spotify not yet indexed (re-resolve at fire time)

---

## 4. Architecture (linear, standalone)

```
DistroKid release complete (tracks.distributed=true, distributedAt set)
        │  (hook in convex/distribution.setSubmitted — one additive call)
        ▼
musicVideoJobs row: { trackId, fireAt = distributedAt + 5d, status:"scheduled" }
        │  (daily Convex cron sweeps for due rows — NO global channel schedule)
        ▼
[1] resolve links  → Odesli/song.link by ISRC/URL (Spotify now propagated)
[2] align lyrics   → download MP3, WhisperX alignment vs known lyric text → timed JSON
[3] render (Trigger.dev cloud, large machine):
        download audio+cover from R2 → ffprobe duration → bundle Remotion
        → renderMedia(VinylMusicVideo) → mp4 → upload to R2 (music-video/{track}/...)
[4] upload (GATED): if Music House Records refreshToken exists →
        youtube.videos.insert (categoryId 10, tags, listen-everywhere desc)
        else stop at status:"rendered" + presigned preview URL for review
```

### New code (all inside `/home/ubuntu/music-house`)
```
src/music-video/
  links.ts            resolveStreamingLinks({isrc, appleUrl}) via Odesli
  lyrics-align.ts     forcedAlign(audioBuf, lyricLines) → TimedLine[] (WhisperX/Groq)
  youtube.ts          ported upload lib (copied from youtube-studio-ai, standalone)
  tags.ts             buildYouTubeTags(track, album) + buildDescription(links)
music-video-remotion/           ← isolated Remotion sub-project (own package.json)
  package.json        remotion@4.0.441 + @remotion/media-utils + @remotion/renderer
  remotion.config.ts
  src/Root.tsx        registers <VinylMusicVideo/>
  src/VinylMusicVideo.tsx
  src/components/{VinylDisc,CircularWaveform,KaraokeLyrics,Background}.tsx
src/trigger/
  music-video-render.ts    Trigger task (machine:"large-2x"), bundle+render+R2
  music-video-upload.ts    Trigger task (gated YouTube upload)
convex/
  musicVideo.ts       scheduleForTrack, listDue, fireDueJobs, markStatus,
                      getJob, getRenderInputs, setChannelAuth, getChannelAuth
  crons.ts            NEW — daily sweep → musicVideo:fireDueJobs
  schema.ts           +musicVideoJobs table, +musicVideoChannel table
  distribution.ts     setSubmitted → +1 line: schedule the +5d job (additive)
scripts/
  connect-music-house-records.ts   one-time OAuth consent → store refreshToken
  render-music-video.ts            manual: run pipeline for a trackId (demo)
  backfill-a-dying-art-links.ts    write verified ISRC+store URLs to the track
docs/MUSIC_VIDEO_CHANNEL_SETUP.md  exact brand-account + OAuth steps for Daniel
```

### Reused (not rebuilt)
- R2 helper `src/lib/storage.ts` (put/getBuffer/presignDownload)
- ffmpeg wrappers `youtube-studio-ai/src/lib/ffmpeg.ts` (ffprobe duration) — copied minimal
- YouTube OAuth/upload patterns from `youtube-studio-ai/src/lib/youtube.ts` (copied in)
- Vinyl-spin keyframes (port from `music-house/globals.css`) → Remotion `interpolate`

---

## 5. Remotion composition — `VinylMusicVideo` (Dark vinyl studio)

Props: `{ coverUrl, title, artist, audioUrl, lyrics: {text,start,end}[], accentColor, durationInFrames, fps }`

Layers (back → front):
1. Black bg + radial spotlight gradient + faint film grain.
2. **CircularWaveform** — `@remotion/media-utils` `visualizeAudio()` FFT bins → radial bars ringing the album; amplitude scales bar length; accent color.
3. **VinylDisc** — disc SVG/PNG, `rotation = interpolate(frame,[0,fps*5.5],[0,360])` looped; positioned offset-right, z BELOW cover (peeks out from behind).
4. **Album cover** — centered-left, drop shadow.
5. **KaraokeLyrics** — large centered; active line by `frame→start` mapping; highlight + smooth scroll; section markers skipped.
6. Footer wordmark "MUSIC HOUSE RECORDS" + intro title card (title/artist) first ~3s.
7. `<Audio src={audioUrl} />` — the real master.

Validation: local `npx remotion render` on "A Dying Art" assets BEFORE wiring the cloud task, so we confirm the look first (cheap iteration).

---

## 6. YouTube metadata
- Title: `A Dying Art — The Dollcat Club (Official Audio)`
- Description: 1-line hook + **Listen everywhere:** `song.link/us/i/6779767417` + per-platform links + Music House Records boilerplate + AI-music disclosure.
- Tags (`tags.ts`): artist, track, album, genre tags, mood, "official audio", "music house records", "new music 2026", lofi/genre-specific — clamped to 30, ≤500 chars total.
- `categoryId:"10"` (Music). `privacyStatus`: `unlisted` until approved → `public`.

---

## 7. Build order
1. Convex: schema (`musicVideoJobs`,`musicVideoChannel`) + `musicVideo.ts` + `crons.ts`. Deploy via `./node_modules/.bin/convex dev --once` (NOT `convex deploy`).
2. Remotion sub-project + `VinylMusicVideo` + components. **Local render of "A Dying Art" → review the look.**
3. `links.ts` + `lyrics-align.ts` (+ vault key check).
4. Trigger tasks: `music-video-render.ts` (cloud) + `music-video-upload.ts` (gated). `trigger deploy`.
5. Release hook in `distribution.setSubmitted` (+5d schedule).
6. `connect-music-house-records.ts` + setup doc.
7. Demo: backfill links → `render-music-video.ts` for the track → R2 preview → report presigned URL. Upload held.

## 8. Verification gates
- Convex deploy READY (functions present); `tsc` clean before assuming live.
- Local Remotion still/preview screenshot reviewed before cloud render.
- Demo mp4 plays from presigned R2 URL (duration matches audio; lyrics tracked; vinyl spins; waveform reacts).
- Upload path unit-checked but NOT fired (no channel yet).

## 9. Out of scope / needs Daniel
- Creating the actual YouTube Brand channel + OAuth consent (manual).
- Enabling the real DistroKid `submit` for "A Dying Art" (separate, needs sign-off).
- Going `public` / un-gating uploads.
