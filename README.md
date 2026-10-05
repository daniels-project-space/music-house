# Music House

AI music label. Suno + Mureka generation, organized catalog with timestamped lyrics, hearts, playlists, distribution-ready.

- **Repo**: `daniels-project-space/music-house` (private)
- **Stack**: Next.js 16, React 19, Tailwind 4, Convex, TypeScript
- **Storage**: Cloudflare R2 via `@daniels-project-space/platform-storage`
- **Background work**: Trigger.dev tasks in `daniels-project-space/platform-jobs/src/trigger/music-house/`
- **Agents** (lyrics, persona, art prompt): added to `daniels-project-space/platform-agents` when needed
- **Secrets**: project-hub Convex vault (`fantastic-roadrunner-485.convex.cloud`), service scopes `suno`, `mureka`, `kits`, `cloudflare`, `replicate`, `elevenlabs`, `anthropic`

## Local dev (run from desktop)

```bash
npm install
npx convex dev          # provisions Convex deployment, writes .env.local
npm run dev             # http://localhost:3000
```

## Deploy

Vercel auto-deploys on push to `main`.

## Migration from legacy ai-music-empire

Legacy lives at `/home/ubuntu/passive-income/ai-music-empire/` on test-vps. Only the rendered audio + album art + `library/.meta/catalog.json` are migrated. All code is fresh.

## Music3 Render Engine connection

The MiniMax form submits a sealed native Music3 request through `/client/music3-jobs`. It preserves source lyrics, pins the current model, requests BF16 full settings with a 300-second ceiling, and verifies the admission digest plus the dedicated `music-house` bucket. A qualification hold remains a waiting request. The Studio polls active jobs while open; completed, independently verified WAV output can be downloaded from Studio or Jobs. This connection does not import generated audio into the catalog or start a schedule.

Configure these server variables before enabling submission:

- `MUSIC_HOUSE_RENDER_ENGINE_CONVEX_SITE_URL`: Engine HTTPS Convex site origin; existing `RENDER_ENGINE_CONVEX_SITE_URL` is also accepted.
- `MUSIC_HOUSE_RENDER_ENGINE_PROJECT_TOKEN`: Music House scoped capability; existing `RENDER_ENGINE_PROJECT_TOKEN` is also accepted.
- `MUSIC_HOUSE_RENDER_ENGINE_MUSIC3_WORKFLOW_ID`: registered immutable Music3 workflow.
- `MUSIC_HOUSE_RENDER_ENGINE_MAX_COST_USD`: approved per-job ceiling, greater than zero and at most 100.

Deploy `convex/jobs.ts` with the website. An optional `MUSIC_HOUSE_RENDER_ENGINE_OUTPUT_BUCKET` must equal `music-house`. Missing or mismatched configuration fails closed. Engine project keys and tokens remain server-side. Native paid dispatch remains governed by the engine's qualification and budget gates.

## Public rendering and job ownership

Studio is open without Google login. It initializes a same-origin, server-signed anonymous browser session in a Secure HttpOnly cookie. Jobs retain that browser subject; other browsers cannot list, poll or download them. Clearing the cookie or its eight-hour expiry loses access to that browser's jobs. No account recovery is claimed. Existing Google sessions remain valid, but login is not required.

Configure the same random `MUSIC_HOUSE_RENDER_SESSION_SECRET` of at least 32 characters on Vercel and the live Music House Convex deployment. Missing session configuration fails closed. The server signs Engine admission/state mutations; browsers cannot forge bindings or completion. Engine project tokens remain server-only, and generic media signers reject the reserved `projects/` namespace.

Owned Suno/Mureka jobs use a random job-scoped worker capability, persist only its digest, and verify it before provider admission and every status update. Deploy existing changed workers with Convex and the app; no task replay or schedule activation is required. Native Music3 uses the Engine's qualification/budget guards and verified project-owned R2 output. No paid render was performed for this bridge validation.
