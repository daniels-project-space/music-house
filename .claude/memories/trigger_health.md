---
name: trigger_health
description: Music-house Trigger.dev project health + silent-fallback fix history
type: project
---

# Music-House Trigger.dev Health

## Status as of 2026-05-19
- Project: `proj_ukkzrxclaoncuvhvqpud` (music-house-jobs, org daniels-project-space-be0b)
- Schedule: `refresh-routenote-auth` cron `0 4 * * 1` — LIVE (Version 20260519.1)
- Last cookie refresh: 2026-05-09 21:25 UTC. Missed 2 weekly fires (`?? ""` bug). Next fire: 2026-05-25 04:00 UTC.

## Fix applied (commit 0ae74d5)
Hardcoded `project: "proj_ukkzrxclaoncuvhvqpud"` in `trigger.config.ts`. Was `process.env.TRIGGER_PROJECT_REF ?? ""` which silently deployed to a phantom project.

## Outstanding gaps
- `TRIGGER_SECRET_KEY` not set on Vercel — `/api/generate` 500s with `ApiClientMissingError`. See `project_music_house_trigger_gap.md` in root memory.
- No alerting/health endpoint. If `refresh-routenote-auth` fails or stops, no one is paged.
- `first-heron-210` Convex prod is a phantom (auto-created by a stray `convex deploy` during bootstrap). Active deployment = `determined-aardvark-936` despite the "dev:" prefix in .env.local.

## DO NOT
- Reintroduce `?? ""` env fallback to trigger.config.ts.
- Trigger `refresh-routenote-auth-now` from autonomous code paths — uses 2Captcha + Playwright credits.
