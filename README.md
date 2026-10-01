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

## Login for rendering

Public catalog and listening views are available without login. Generation, prompt/lyrics/cover creation, research, and distribution controls require an authenticated Google account from the approved render-owner list. New jobs store the immutable Google subject, and only that subject may poll or download their result. The public Convex job readers exclude owned jobs; authenticated readback uses the server routes. Unowned legacy jobs are not automatically adopted. The engine admission and status ledger also require a signed server proof, so a logged-in browser cannot substitute another engine job or forge a completion.

Configure `MUSIC_HOUSE_GOOGLE_CLIENT_ID`, `MUSIC_HOUSE_GOOGLE_CLIENT_SECRET`, `MUSIC_HOUSE_AUTH_BASE_URL` (the HTTPS site origin), and `MUSIC_HOUSE_RENDER_OWNER_EMAILS` (comma-separated approved account emails) on Vercel. Register `${MUSIC_HOUSE_AUTH_BASE_URL}/api/auth/callback` as the Google OAuth callback. Configure the same random `MUSIC_HOUSE_RENDER_SESSION_SECRET` of at least 32 characters on Vercel and the live Music House Convex deployment. The login is separate from Project Hub's vault-administration session, which is not a shared app-login issuer. Missing login setup fails closed.

Owned Suno/Mureka jobs use a random job-scoped worker capability, persist only its digest, and verify it before provider admission and every status update. Deploy the changed Trigger workers together with the app and Convex schema; already queued unowned jobs retain their worker path. Owned jobs ignore unauthenticated early-failure callbacks and rely on worker polling.

The authorization flow uses PKCE, state, nonce, and cryptographic Google ID-token checks; sessions use secure HttpOnly cookies and an eight-hour expiry. Generation POSTs require the same Origin. No login setup activates provider renders or schedules.
