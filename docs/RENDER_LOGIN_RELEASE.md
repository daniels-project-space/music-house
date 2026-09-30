# Render login release

## Verified deployment identities

- Repository: `daniels-project-space/music-house`.
- Vercel project: `prj_B0Hdhe2g5A15sX0Cqy9fIAisJNiI`, team `team_VY2PwHgXLV9Bo0vs2iXdnGxw`.
- Production origin: `https://music-house-nine.vercel.app`.
- Music House Convex: `determined-aardvark-936` (`dev:determined-aardvark-936` is the existing deployment used by the production website).
- Trigger project: `proj_ukkzrxclaoncuvhvqpud`, declared in `trigger.config.ts`.

## Identity prerequisites

Confirm the approved Google account before setting `MUSIC_HOUSE_RENDER_OWNER_EMAILS`. A Git author email is not approval or authenticated identity evidence.

The vault has `youtube/YOUTUBE_CLIENT_ID` and `youtube/YOUTUBE_CLIENT_SECRET`. These may be reusable after confirming that the registered OAuth client is a Web application and permits the exact callback below. The Music House YouTube setup document mentions localhost and an older Studio callback; it does not establish registration for the new login callback. A non-consent authorization request reached Google sign-in, which proves neither callback registration nor account authorization. Project Hub has a vault-admin password session, not a general app login issuer.

Register this exact authorized redirect URI on the approved Google Web OAuth client:

`https://music-house-nine.vercel.app/api/auth/callback`

The request uses `openid email`, code flow, PKCE, state and nonce. It does not request YouTube upload or account-management access. Follow [Google's Web server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server).

## Server settings

Set the following encrypted production variables on the named Vercel project:

| Variable | Binding |
| --- | --- |
| `MUSIC_HOUSE_GOOGLE_CLIENT_ID` | Approved Web OAuth client ID |
| `MUSIC_HOUSE_GOOGLE_CLIENT_SECRET` | Its matching secret |
| `MUSIC_HOUSE_AUTH_BASE_URL` | `https://music-house-nine.vercel.app` |
| `MUSIC_HOUSE_RENDER_OWNER_EMAILS` | Explicitly approved account email(s) |
| `MUSIC_HOUSE_RENDER_SESSION_SECRET` | New cryptographically random signing secret, at least 32 characters |

Generate the signing secret once inside a trusted credential process, persist it in the Music House scoped vault, and inject the same value into Vercel and the exact Music House Convex deployment. Do not print it, pass it as a shell literal, or store it in repository files. When using `convex env set`, use a restricted temporary file via `--from-file` and remove that file after successful injection. Verify presence and an in-process equality check; never print values or hashes.

Trigger workers do **not** need the session secret or Google client secret. The authenticated server creates a random job-specific worker token and passes it in the Trigger payload; Convex stores only its SHA-256 digest. Workers verify admission before provider requests, and supply the token for every owned-job state update. Native Music3 uses authenticated engine readback and signed server proofs instead.

## Ordered release without triggering runs

1. Keep login configuration incomplete until backend deployment verification is complete; new authenticated generation remains closed. Record existing schedule IDs, active states, queues and current Trigger version through read-only metadata. Do not create, activate, pause, replay or trigger tasks during this release.
2. Review and merge the exact auth commit only after identity approval. Deploy Convex schema/functions to `determined-aardvark-936`. Existing unowned jobs remain compatible; newly owned jobs require the session/capability checks.
3. Build and deploy the changed Trigger workers to `proj_ukkzrxclaoncuvhvqpud` with `--env prod --skip-promotion --skip-sync-env-vars --skip-update-check`. Use the existing authenticated, version-matched CLI; preserve existing runtime credentials. This stages a version without making it current. Verify the deployment status and task inventory, then compare schedule metadata against the recorded baseline. Do not run smoke-test tasks.
4. When backend readiness is verified and release approval covers promotion, promote that exact Trigger version. Promotion selects code for future runs; it does not justify replaying old jobs. Verify current version and unchanged schedule active states. If schedule state differs, stop before making the website capable of authenticated generation.
5. Deploy the reviewed website to the exact Vercel production alias. Set the shared signing secret on Convex and Vercel, and supply the approved OAuth settings. Verify anonymous generation/control POSTs return 401, public Studio/Library remain 200, and login initiates the approved client/callback.
6. Complete a real approved-account browser login without submitting a render. Verify `/api/auth/session` is authenticated, the owned-job list contains no foreign jobs, cross-origin POSTs return 403, and anonymous/foreign status and output reads remain rejected. Do not treat a 503 missing-configuration response as a completed login feature.

[Trigger deployment documentation](https://trigger.dev/docs/deployment/overview) describes `--skip-promotion` and version locking. Project Hub's `docs/project-setup.md` requires deploying each app's own Convex and Trigger backends before verifying its website production alias. No step authorizes paid renders, distribution, schedule activation, or replaying existing runs.
