# Music House Records — YouTube channel setup (one-time)

The standalone Music Video pipeline uploads to a YouTube channel called
**Music House Records**. A YouTube channel **cannot be created via API** — these
manual steps are required once. After this, every released single auto-publishes
a video 5 days later (gated on this token existing).

## 1. Create the channel (Brand Account — recommended)

1. Sign into the Google account that should own the label channel.
2. Go to <https://www.youtube.com/channel_switcher> → **Create a channel** →
   choose **Use a custom name** to make a **Brand Account** named
   `Music House Records` (keeps the channel identity separate from a personal
   Google account; multiple managers possible).
3. In YouTube Studio, set the avatar/banner and **verify the channel by phone**
   (required before custom video thumbnails work).

## 2. Register the OAuth redirect URI

The pipeline reuses the existing `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`
(no new Google Cloud project needed). In Google Cloud Console → APIs & Services →
Credentials → that OAuth client → **Authorized redirect URIs**, ensure one of
these is present (use it as `--redirect-uri` below):

- `http://localhost` (simplest for a paste-the-code flow), or
- an existing registered URI from the youtube-studio-ai client.

## 3. Connect (capture the channel refresh token)

```bash
cd /home/ubuntu/music-house
npx tsx scripts/connect-music-house-records.ts --redirect-uri http://localhost
```

- Open the printed consent URL **in a browser signed into the channel owner
  account**, pick the **Music House Records** Brand Account, approve scopes.
- The browser redirects to `http://localhost?code=...` (the page may fail to
  load on a remote server — that's expected). Copy the full URL (or just the
  `code` value) and paste it back into the script.
- The script prints the channel title + a **refresh token**.

## 4. Store the token (this is the upload gate)

Save the printed value as **`YOUTUBE_REFRESH_TOKEN_MUSIC_HOUSE_RECORDS`** in:

- **Trigger.dev dashboard → project `proj_ukkzrxclaoncuvhvqpud` env vars** — for
  the cloud pipeline.
- **`music-house/.env.local`** — for local renders.
- *(optional)* the secrets vault under service `youtube`.

Until this key exists, renders complete and land in R2 but uploads stay
**held** (status `held`) — by design.

## 5. (optional) Go public

Uploads default to `unlisted`. To publish publicly, run the render with
`--privacy public`, or flip the privacy in YouTube Studio after review.

---

## How the schedule works (no per-channel cron)

- When a single's DistroKid release completes (`distribution.setSubmitted`), the
  pipeline writes a `musicVideoJobs` row with `fireAt = distributedAt + 5 days`.
- The single recurring job, `music-video-sweep` (daily ~06:23 UTC), fires any
  due rows — it is a generic heartbeat, not a channel cadence.
- Manual control: `scripts/render-music-video.ts --track <id> --fire-now`.

## ⚠️ Cloud render packaging (go-live check)

The render uses the self-contained Remotion project in `music-video-remotion/`
(its own deps + Chromium). The **local** demo path renders directly on the VPS
and is proven. For the **Trigger.dev cloud** render task to run, the worker image
must include `music-video-remotion/` **with its node_modules installed** (and
`MV_REMOTION_DIR` pointing at it). Validate this once before relying on the
unattended cloud path; until then, run renders via `scripts/render-music-video.ts`.
