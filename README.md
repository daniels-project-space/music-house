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
