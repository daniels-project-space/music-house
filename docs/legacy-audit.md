# Music House — Legacy Audit & Rebuild Spec

This document is the source of truth for rebuilding Music House cleanly on the new stack (Next.js 16 + Convex + R2 + Trigger). It is the output of the deep-look phase per `feedback_app_migration_methodology.md`. **Reference this spec when implementing — never the legacy source.**

Legacy lives at `/home/ubuntu/passive-income/ai-music-empire/` on test-vps and stays read-only. New code lives in this repo.

---

## 1. What the legacy app actually does

Six-tab dashboard for an AI music label:

1. **Library** — browse generated tracks, organized into albums, organized into sections (Film & Cinematic, Artist Songs, Gaming, Unsorted)
2. **Studio** — generate new tracks (Suno V5.5 + Mureka V8 with engine switcher), prompt enhancement via Claude, batch generation, suno-specific album builder
3. **Analytics** — track counts, costs, totals
4. **Distribution** — DistroKid-bound queue (ready vs distributed)
5. **Playlists** — user-curated cross-album sets
6. **Archive** — soft-deleted tracks with restore

Persistent UI: top-bar (logo/sub/tabs/search/gen-indicator), pipeline counters strip (Generating/Mixing/Ready/Distributed), bottom player with prev/play/next + scrubber + shuffle, modal layer (lyrics, move-to-album, confirm-delete, new-album).

---

## 2. Design tokens (preserve — these are the product's personality)

**Fonts**
- Display: `Outfit` (300/400/600/700/800)
- Mono: `JetBrains Mono` (400/600/700)
- Loaded via Google Fonts CSS link

**Colors**
- Background: `#050608` base, `#0a0c12` raised, with subtle radial gradients (purple top-left at 4% alpha, pink bottom-right at 3% alpha)
- Surfaces: `card rgba(14,17,24,.92)`, `surface rgba(20,24,33,.85)`, `elevated rgba(28,33,45,.9)`
- Borders: `brd rgba(45,52,70,.4)`, `brd-a rgba(139,92,246,.25)` (hover/active)
- Accent palette:
  - `purple #8b5cf6` — primary action, mix, links
  - `pink #ec4899` — generation, hot accents, gradient pair with purple
  - `cyan #06b6d4` — distribution, share
  - `green #34d399` — ready, success, distribute action
  - `amber #fbbf24` — autocomplete, warnings
  - `red #ef4444` — delete, failure
- Text: `t1 #e8ecf4` primary, `t2 #94a3b8` dim, `t3 #4a5568` muted, `t4 #2d3548` faint

**Spacing & radius**
- Radius: `r 10px` for cards, `rl 16px` for large containers
- Common gaps: `0.4rem`, `0.6rem`, `1rem`, `1.2rem`, `1.5rem`
- Container: full-width with `1.5rem` horizontal padding (no max-width on legacy — we should adopt `1440px` cap for the rebuild)

**Animations** (all keep)
- `breathe 2s ease infinite` — generation indicator pill (opacity 1→.5→1)
- `pulse 1s infinite` — small status dots (scale 1→1.5)
- `cover-pulse 3s ease infinite` — album cover during playback (shadow grows)
- `shim 2s infinite` — shimmer line on card hover
- `fi 0.3s ease` — section/tab fade-in (`opacity 0/translateY(4px)` → `1/0`)
- Hover lift on cards: `translateY(-4px) + shadow + brd-a border`
- Cubic-bezier `.4,0,.2,1` for transitions

**Signature visual moves to preserve**
- Pink→purple gradient on the title and the play CTA in covers
- Active tab indicator: 2px pink underline (20%-80% width)
- Stage counter chips with colored numbers (pink/purple/green/cyan)
- Mono-uppercase labels at `.5rem` with `.08em` letter-spacing
- Karaoke lyrics: 5 size tiers (`active 0.95rem` → `near1 0.74` → `near2 0.64` → `far 0.56`), opacity gradient, smooth scroll with masked top/bottom 44px fade

---

## 3. Information architecture (page tree for the rebuild)

```
/                       Home — at-a-glance dashboard, link grid
/library                Library tab — section bands + album grid
/library/[artist]       Artist's albums + tracks
/library/[artist]/[album]  Album detail — header + track list + lyrics-on-play
/studio                 Studio tab — Generate (Suno|Mureka switcher) + queue
/studio/suno/[albumId]  Suno album-builder detail (per-track gen, lyrics, mix)
/analytics              Analytics tab — totals, costs, breakdown
/distribution           Distribution tab — ready + distributed queues
/playlists              Playlists tab — list + tracks per playlist
/archive                Archive tab — restore-able tracks
/track/[id]             Track detail (lyrics editor, notes, rating, hearts)
```

Persistent shell layout:
- `<TopBar>` with brand + nav tabs + search + gen-indicator
- `<PipelineStrip>` with 4 stage counters (only on tabs that benefit)
- `{children}`
- `<Player>` sticky bottom (prev/play/next, progress, shuffle, queue popover)
- `<ModalRoot>` for lyrics karaoke, move-to-album, confirm, new-album

---

## 4. Feature inventory (UI ↔ backend ↔ keep/drop)

| Feature | Legacy UI | Legacy backend | Decision | Notes |
|---|---|---|---|---|
| Browse albums by section | Library tab grid + section headers | `GET /api/albums`, `GET /api/catalog` | **Keep** | Convex `albums` query + group by section |
| Drag album between sections | drag-drop on album card | `POST /api/albums/:art/:slug/section` | **Keep** | Add `section` field to albums table |
| Drag track between albums | drag track row | `POST /api/track/:id/move` | **Keep** | Convex mutation |
| Reorder track in album | drag within list | `POST /api/track/:id/reorder` | **Keep** | Convex mutation w/ position |
| Heart track | ♥ button | `POST /api/track/:id/heart` | **Done** | Already in scaffold |
| Hearted filter | Hearted button | client-side filter | **Keep** | Use hearts table |
| Batch select + multi-action | Select toggle, sticky action bar | client + per-id loops | **Keep** | useState<Set<Id>>, batch mutations |
| Inline rename track | contenteditable title | `POST /api/track/:id/rename` | **Keep** | Convex `tracks.rename` mutation (add) |
| Inline rename album | prompt() | `POST /api/albums/:art/:slug/rename` | **Keep** | Convex mutation |
| Track row ⋮ menu | dropdown (lyrics, move, playlist, distribute, archive, delete) | several routes | **Keep** | One Popover component |
| Show lyrics modal | karaoke scrolling lyrics | static (timestamps in track) | **Keep** | Karaoke renderer per `lyrics[]` field |
| Mix toggle (raw vs mixed) | MIX button on track | `tgMix` client-only | **Drop for now** | RVC + studio_mix.py is dropped per memory; tracks now only have one audio variant |
| Pipeline counters | top strip Generating/Mixing/Ready/Distributed | `GET /api/stats`, `/api/generating` | **Keep, simplified** | Counts from `generationJobs.status` + `tracks.distributed` |
| Album header — Play All | Play All button | client `buildQ()` | **Keep** | Player queue from track list |
| Album header — Shuffle | Shuffle button | client | **Keep** | Same |
| Album header — Share | copies `/library/<art>/<slug>` link | clipboard API | **Keep** | Trivial |
| Album header — Complete Album | Autocomplete panel + LLM | `POST /api/albums/:art/:slug/complete` | **Keep** | Move to Trigger.dev task |
| Album header — Studio Mix | (only Suno albums) | `POST /api/suno/mix-album/:id` | **Drop** | RVC dropped; if you want re-mastering later, separate task |
| Cover generation | Auto on album create | `POST /api/albums/:art/:slug/generate-cover` (Replicate Flux) | **Keep** | Trigger task `generate-cover-art` invoking `replicate.ts` |
| Studio — Generate Track | textarea + Enhance button + Generate | `POST /api/creator/generate-suno` | **Keep, rebuilt** | Already scaffolded in `/create` |
| Studio — Enhance Prompt | LLM rewrites prompt | `POST /api/enhance-prompt` | **Keep** | Convex action calling Anthropic |
| Studio — Album (10 trk) | one-shot 10-track gen | `POST /api/creator/generate-suno` mode=album | **Keep** | Trigger task fan-out |
| Studio — Suno album builder | grid of suno albums + per-track gen | many `/api/suno/*` routes | **Keep** | Becomes a sub-page `/studio/suno/[albumId]` |
| Studio — Suno per-track lyrics gen | "Gen All Lyrics" | `POST /api/suno/albums/:id/tracks/:i/lyrics` | **Keep** | Trigger task using Mastra `lyricsWriter` agent |
| Studio — Suno API key in-UI | settings modal | `PUT /api/suno/config` | **Drop** | Keys live in vault now, not in UI |
| Distribution queue | two columns | `POST /api/track/:id/distribute` | **Keep** | Add `distributedAt` timestamp; integrate DistroKid only when real flow exists |
| Playlists CRUD + add/remove | Playlists tab | `/api/playlists/*` | **Done** | Already scaffolded |
| Archive + Unarchive | Archive tab + restore | `/api/track/:id/{archive,unarchive}` | **Keep** | Already scaffolded |
| Search projects | top-bar input | client substring | **Keep** | Cross-tab search over tracks/albums |
| Lyrics editor (suno-specific) | textarea modal | `PUT /api/suno/albums/:id/tracks/:n/lyrics` | **Keep** | Just track edit, available on `/track/[id]` |
| Whisper lyrics-align | invoked post-generation | `POST /api/track/:trackId/align` runs `lyrics_align.py` | **Keep, deferred** | Trigger task w/ Whisper API or self-hosted; if too heavy, skip in v1 |
| Reference artist gallery | creator.html — pick artist→get image set | `GET /api/artist-images/:genre` | **Drop in v1** | Pinterest/Replicate scrape — nice-to-have, defer |
| Creative Director chat | creator.html — multi-turn brainstorm | `POST /api/creative-director*` | **Drop in v1** | Use the Mastra `personaDesigner` agent inline as needed |
| Chat Sonnet | creator.html — chat panel | `POST /api/chat-sonnet` | **Drop in v1** | Out of scope; reachable via Mastra later |
| CLAP analyze upload | drag MP3 → score | `POST /api/analyze` w/ multer | **Drop in v1** | Niche; can return as separate tool |

Stripped entirely (confirmed dead or intentionally dropped):
- All RVC voice swap routes/UI (already locked in `project_ai_music_empire_migration.md`)
- Suno API key in UI — secrets live in vault
- Voice upload → swap pipeline, Kits.ai integrations
- Replicate voice swap variants (`replicate_voice_swap*.py`)
- One-off scripts and `.bak` HTMLs

---

## 5. Implementation plan

### Phase A — schema additions (Convex)

Add to `convex/schema.ts`:
- `albums.section`: optional string (`"film_cinematic" | "artist_songs" | "gaming" | "unsorted"`)
- `tracks.archivedAt`: already present
- `tracks.position`: for in-album ordering (currently uses `trackNum`)
- A `pipelineCounts` query that returns `{generating, mixing, ready, distributed}` derived from `generationJobs.status` and `tracks.distributed`

Add mutations:
- `albums.setSection`, `albums.rename`, `albums.delete`
- `tracks.rename`, `tracks.move`, `tracks.reorder`, `tracks.distribute`
- `tracks.shareLink` (computed)

### Phase B — design system layer

Replace placeholder Tailwind with the legacy palette ported to Tailwind 4 `@theme`:
```
--color-bg, --color-bg2, --color-card, --color-surface, --color-elevated
--color-brd, --color-brd-a
--color-purple, --color-pink, --color-cyan, --color-green, --color-amber, --color-red
--color-t1, --color-t2, --color-t3, --color-t4
--font-display ("Outfit"), --font-mono ("JetBrains Mono")
--radius (10px), --radius-lg (16px)
```
Animations as utility keyframes: `animate-breathe`, `animate-cover-pulse`, `animate-shim`, `animate-fi`, `animate-pulse-dot`.

### Phase C — shell layout

`src/app/layout.tsx`:
- `<ConvexProvider>`, `<PlayerProvider>`, `<ModalProvider>`
- `<TopBar>` with brand + tabs + search + gen-indicator
- `<PipelineStrip>` (rendered conditionally on Library/Studio)
- `{children}` in `<main>`
- `<Player>` sticky
- `<ModalRoot>`

### Phase D — feature pages, in priority order

1. **Library** (`/library`) — section bands, album cards with cover/title/meta/track count, hover shimmer + lift, drag-and-drop section assignment
2. **Album detail** (`/library/[artist]/[album]`) — header w/ playing-pulse cover, track list with all the legacy interactions (heart, ⋮, mix-toggle hidden, contenteditable rename), karaoke lyrics modal
3. **Studio** (`/studio`) — generator with Suno|Mureka switcher (keep, do not collapse to single — it's the differentiator), Enhance button calling Mastra, queue display
4. **Player** improvements — queue, shuffle, lyrics modal trigger
5. **Pipeline strip** — top counters
6. **Distribution / Playlists / Archive** — port the layouts; functionality is straightforward
7. **Track detail** (`/track/[id]`) — already exists; polish to legacy aesthetic
8. **Search** — top-bar input opens a cross-cut popover with track + album hits

### Phase E — backend wiring

- `/api/generate` already calls Trigger.dev; needs to also enrich the Suno generate to pass `callbackUrl` pointing at `https://determined-aardvark-936.convex.site/suno/webhook`
- Convex HTTP action `/suno/webhook` — handle the webhook (already stubbed; flesh out body parse and result write)
- New Convex action `enhancePrompt` calling Anthropic via `lib/anthropic.ts`
- Trigger task `align-lyrics` (Whisper) — deferred / optional

### Phase F — migration

- Existing Convex catalog (167 tracks) imported. Now also need to:
  - Set `section` field on albums based on legacy `catalog.json` section data (re-run migration with section mapping)
  - Add cover keys for any legacy albums that have `cover.jpg/png` in R2 but aren't pointed at by tracks (album-level cover key)
  - Set initial `position` for tracks within each album

---

## 6. Open questions (need Daniel's call)

- **Section taxonomy**: legacy uses Film & Cinematic / Artist Songs / Gaming / Unsorted. Keep these four exactly, or rethink (e.g. add Lofi, Hip-Hop)?
- **DistroKid integration**: legacy has the queue but no actual API push. Want to integrate now (manual upload via DistroKid CLI or UI?), or keep "distribute" as a flag for hand-off?
- **Lyrics alignment**: Whisper-based timestamping is heavy. v1 ships without auto-alignment? Manual paste of timestamped lyrics for now?
- **Search scope**: just track titles + album names, or also lyrics-content full-text?
- **Player keyboard shortcuts**: legacy has none. Add space/arrow shortcuts in rebuild?

---

## 7. What this spec does NOT do

- Doesn't carry over any code, CSS, or HTML from legacy
- Doesn't import the legacy `server.js` patterns (the new app is Convex-first)
- Doesn't preserve broken or dead routes
- Doesn't bring RVC, voice swap, KitsAI, Whisper Python wrappers, Pinterest scrapers, or the Aria-style chat helpers

When implementing: read this spec, write fresh code. If a behavior is unclear here, open the legacy file once for reference, then close it.
