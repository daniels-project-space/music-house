# DistroKid distribution (reverse-engineered CLI)

Replaces the RouteNote path for releases sent to DistroKid. Built 2026-06-11. DistroKid has **no public API**; this is a reverse-engineered HTTP flow driven by a Go CLI with a thin browser bootstrap.

## First live release
- **A Dying Art** / The Dollcat Club — release id `43779AC3-FC06-4756-9176841FC0E32E3B`
- https://distrokid.com/hyperfollow/thedollcatclub/a-dying-art

## Components
- **Binary:** `/usr/local/bin/distrokid-cli` (Go, v1.0.0). Source: `/root/distrokid-cli-build/distrokid-cli/`.
- **Bootstrap helper:** `/usr/local/share/distrokid-cli/helpers/bootstrap.mjs` (Playwright + chromium-1217 under Xvfb) — loads `/new`, clears Cloudflare, scrapes the per-load signed S3 globals, does the in-page S3 POST.
- **Music House wiring:** `src/lib/distrokid-cli.ts` → `runDistrokidCli()` `execFile`s the binary with `DISTROKID_COOKIES` in env (cookie JSON from Convex `distributorAuth`). Orchestrated by `src/trigger/distribute-single-distrokid.ts`.

## Auth
Session cookies only (no token). `DISTROKID_COOKIES` = JSON `CookieEntry[]` (DistroKid uses `DK_SYN`, `cfid/cftoken`, `BEEFARONI`). Stored in vault key `DISTROKID_COOKIES` (service `distrokid`, scope `music-house`) and Convex `distributorAuth`. **Refresh:** re-export via Cookie-Editor on distrokid.com when the session expires; update both. Server-side replay from the IONOS datacenter IP works (no anti-bot block); Cloudflare "Just a moment" is cleared by the headed bootstrap.

## The 9 subcommands ↔ DistroKid's real 3-phase flow
DistroKid has no per-step REST API. The CLI is **stateful** (local draft at `~/.distrokid-cli/drafts/<id>.json`) and maps:
- `create-release` → bootstrap `/new` (client-gen `albumuuid` + signed S3 policy), print bare id. **Hits DistroKid.**
- `upload-audio` / `upload-artwork` → browser S3 POST multipart to `uploader.distrokid.com` (204). **Hits DistroKid (reversible — orphan objects until a save references them).**
- `release-info` / `track-metadata` / `set-ai-disclosure` / `select-stores` → accumulate into the local draft. **No network.**
- `save-draft` → finalize + validate the full `distroAlbumPayload` locally. **Does NOT distribute** (= Music House `dryRun` stop).
- `submit` → the ONLY distributing call: `POST /api/distroAlbumSave/`. Hard-gated by `DISTROKID_CLI_ALLOW_SUBMIT=1`. Prints JSON `{upc,releaseId,url}`.

## Deployment (important)
The CLI drives its **own headed Chromium under Xvfb** to clear Cloudflare. This **cannot run in Trigger.dev cloud** (no Go binary, no Xvfb, no Cloudflare-capable headed browser there — the Trigger playwright extension only covers in-task Node Playwright). **Run the DistroKid Trigger task on the IONOS VPS:** either a Trigger **self-hosted worker** on IONOS, or keep orchestration in Convex/Trigger and **invoke the binary over SSH to IONOS**. (Mirrors the RMv2 "headed-Chromium bootstrap runs LOCALLY, not in Trigger" precedent.)

## ⚠️ Before the first unattended LIVE submit
The CLI's `submit` builds `distroAlbumPayload` best-effort (the successful "A Dying Art" submit's HAR wasn't flushed). **Diff the CLI's `distroAlbumSave` body against a real captured one** before relying on unattended live submit. The live submit also needs the `artistNameLookupApple` availability cached `status:"ok"` — the bootstrap handles this in the headed flow.

## Future releases
Metadata is sourced from the Music House album `description` + artist record (not hardcoded) — see the `musichouse-distrokid-metadata-source` rule. Songwriter legal name is the one field not in records (release #1 = Daniel Broj). Run via the Trigger task with `dryRun:true` first (stops at `save-draft`, nothing distributed), eyeball, then `dryRun:false` + `DISTROKID_CLI_ALLOW_SUBMIT=1` for live.
