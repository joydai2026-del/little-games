# avery-hub environments

| Item | Staging | Production |
|---|---|---|
| Worker | `avery-hub-staging` (`wrangler deploy --env staging`) | `avery-hub` (`wrangler deploy`), JJ-approved release only |
| Address | `https://avery-hub-staging.joyd-ai-2026.workers.dev` | `https://hub.averystudio.org` (custom domain; `workers_dev: false`, `preview_urls: false`) |
| D1 database | `avery_hub_staging` (id `b287b7d8-bec3-437b-805c-d0a41987ebde`) | `avery_hub` (not created yet; replace `REPLACE_WITH_PRODUCTION_D1_ID` in `wrangler.jsonc` when it is) |
| Google project and OAuth client | staging project, consent screen in Testing (listed test users only, up to 100) | production project, consent screen Published |
| Google callback URIs to register | `https://avery-hub-staging.joyd-ai-2026.workers.dev/auth/callback`, `http://localhost:8787/auth/callback` | `https://hub.averystudio.org/auth/callback` only |
| Stripe | test mode (from S2a) | test mode through S4, live from S5 |
| Secrets | own values | own values |
| Game registry and return URLs | staging game Workers (`GAME_REGISTRY` in `env.staging.vars`) | `https://<game>.averystudio.org/auth/finish` |
| Cloudflare Access on `/admin/*` | its own Access application; `ACCESS_*` vars | its own Access application; `ACCESS_*` vars |
| PostHog | off (S4a) | production project (S4a) |
| Alerts | `avery-alert-staging` (S2b) | `avery-alert` (S2b) |

Environments inherit `routes` but not bindings or vars, so `env.staging` repeats every binding and sets `routes: []`.
`tests/wrangler-env.test.ts` fails if the copy drifts.

## Release steps

| Step | Command |
|---|---|
| 1. Tests and types | `npm test && npm run typecheck` |
| 2. Migrations first (additive only) | `npm run migrate:staging` (production: `wrangler d1 migrations apply avery_hub --remote`) |
| 3. Deploy | `npm run deploy:staging` |
| 4. Live check | `curl <hub>/healthz`, `/internal/x` is 404, `/admin/x` is 403 |
| App rollback | `wrangler rollback --env staging` (migrations are additive, so the previous version still runs) |
| Migration rollback | a new forward-fix migration; never edit an applied file |

## Backup and restore

- D1 Time Travel: `wrangler d1 time-travel info avery_hub_staging --env staging` prints the current bookmark;
  `wrangler d1 time-travel restore avery_hub_staging --env staging --bookmark=<id>` restores. The info step was run on
  staging on 2026-09-29; a full restore rehearsal is still to do (it rewinds the whole database, so do it on an empty
  staging database or with JJ's go-ahead).
- Weekly `wrangler d1 export avery_hub --remote --output <private path>`, kept in private storage, never in git.

## Secrets (names only; JJ sets values with `wrangler secret put <NAME> [--env staging]`)

| Name | Needed for |
|---|---|
| `SESSION_HASH_KEY_V1` (and `_V2` during a rotation) | every session, token and pass hash. Without it sign-in shows "Can't sign in right now" |
| `GOOGLE_CLIENT_SECRET` | Google sign-in (with the `GOOGLE_CLIENT_ID` var) |
| `STRIPE_*` | S2a and later |

Game keys are NOT hub secrets: the hub stores only `keyHash` (sha256 hex) in `GAME_REGISTRY`; each game Worker holds its
own key as its secret `HUB_GAME_KEY`. See `rotation.md`.
