# avery-hub information security program

The one-page written program for the teacher-account service behind the Avery Studio games. It describes what exists in
this repository today (S1 hub). Items only the owner can settle are marked `[JJ: ...]`. Review it every 6 months and after
any incident; the date of the last review goes at the bottom.

## 1. What data exists and where

| Data | Where | Whose | Kept until |
|---|---|---|---|
| Teacher Google id (`sub`), email, display name | D1 `teachers` (`avery_hub`, staging `avery_hub_staging`) | teachers only | account deletion (tombstone keeps only id, Stripe customer id, deletion time) |
| Hub sessions and game sessions (HMAC of the id, browser label such as "Chrome on Mac", timestamps) | D1 `sessions`, `game_sessions` | teachers | sign-out, expiry (30 days idle, 90 days max; game 4 h idle, 12 h max), or deletion |
| Saved lists, classes, class codes, round history (game, mode, time, player-count band) | D1 `lists`, `classes`, `round_history` | teachers | deletion |
| School seat grants (school roster email, school reference, end date) | D1 `seat_grants` | the school's purchase record | seat end plus `SEAT_GRANT_RETENTION_DAYS` (400), removed by the daily clean-up |
| Room passes (HMAC of the pass id, game, room code, allowed modes) | D1 `room_passes` | teachers (no personal data) | expiry clean-up `[later slice]` |
| Subscriptions, Stripe events, billing operations | D1 `subscriptions`, `stripe_events`, `billing_ops` (tables exist; filled from S2b) | Ownly Network LLC tax records | kept after account deletion, pointing at the tombstone |
| Admin actions | D1 `admin_log` | JJ | indefinitely `[JJ: set a retention]` |
| One-time sign-in values (hand-off token, OAuth state, device-picker value), stored only as HMACs | `TokenDO` Durable Object storage | teachers | deleted by an alarm after expiry (60 s hand-off, 10 min state and picker) |
| Kids | NOTHING in the hub. The hub has no kid screen, no kid route and no kid table. Room rankings and nicknames live only in each game's Room Durable Object and are deleted with the room | | |

No passwords exist (Google sign-in only). No raw session, token or pass value is stored anywhere.

## 2. Who and what can reach it

| Path | Who | Control |
|---|---|---|
| Public routes (`/auth/*`, `/me`, `/me/export`, `/me/delete`) | a teacher, only her own data | hub session cookie (`__Host-`, Secure, HttpOnly, SameSite=Lax), every query bound to her teacher id (`src/db/`, `forTeacher`), POST + Origin + CSRF on changes |
| `HubService` RPC | Avery game Workers only | service binding (no public route), per-game key checked against a stored hash, per-game method list, audience check on every session and pass |
| `/admin/*` (grant or revoke access, move teacher, grant seats) | JJ, or an agent holding the Access service token | Cloudflare Access plus the hub's own check of the Access JWT (signature, issuer, audience); every action written to `admin_log` |
| D1 console, Worker logs, secrets | Cloudflare account members | `[JJ: list who has access to the Cloudflare account; require 2-factor sign-in for each]` |

## 3. Secrets

Secrets are set only with `wrangler secret put` by JJ and are never in git, logs, URLs or tests (tests make random
values in memory). Hub secrets: `SESSION_HASH_KEY_V1`/`_V2`, `GOOGLE_CLIENT_SECRET`, `RATE_KEY`; later `STRIPE_*`.
Each game holds its own `HUB_GAME_KEY`; the hub keeps only its SHA-256. Rotation steps: `docs/ops/rotation.md`
(every 6 months, at once on any leak).

## 4. Logging rules

| Rule | How it holds today |
|---|---|
| Log no personal data | the hub logs three things only: `hub error <message>` on an unexpected error, `AVERY_ALERT HubService.<method> internal error: <message>`, and the clean-up counts. No email, name, cookie, token or IP is logged by our code |
| No raw client address anywhere | the sign-in abuse bucket uses HMAC(`RATE_KEY`, address) and only inside Cloudflare's rate limiter |
| No logs or analytics on kid screens | the hub serves no kid screen; every game must keep kid screens free of analytics and logging of kid input (plan rule; checked in each game's review) |
| Log retention | Workers observability is on for the hub `[JJ: confirm the Cloudflare plan's log retention and keep it at the shortest window]` |

## 5. Breach response

| Step | Who | When |
|---|---|---|
| 1. Contain: rotate the affected secret (`rotation.md`), revoke sessions (`DELETE FROM sessions` ends every hub and game session), roll back the Worker (`wrangler rollback`) | JJ or the on-call agent with JJ's approval | at once |
| 2. Scope: which tables, which teachers, which time window (D1 Time Travel, `admin_log`, Worker logs) | JJ | within 3 days |
| 3. Notify affected teachers (and schools, for seat emails) in plain English by email from `hello@averystudio.org` | JJ | as soon as the scope is known and no later than 30 days after discovery (the Illinois notice deadline) `[JJ: confirm with counsel which states and regulators also need notice, and whether the FTC must be told]` |
| 4. Write up: cause, fix, what changes; add a test that would have caught it | agent, JJ approves | within 2 weeks |

## 6. Review

Every 6 months (with the key rotation) and after any incident: re-read this page against the code, update the tables,
re-run the isolation and admin tests, and check the Cloudflare account member list. Owner: `[JJ: name the owner]`.

Last reviewed: 2026-09-29 (written with the S1 hub, fix round 3).
