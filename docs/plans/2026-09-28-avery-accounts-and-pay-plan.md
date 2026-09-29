---
date: 2026-09-28
revised: 2026-09-29
topic: Avery accounts and pay (Google sign-in, D1, Stripe under Ownly Network LLC)
status: plan version 3 (hard paywall, $29 a year, gate in all six games, materials included). Version 2 passed two review rounds; version 3 changes only what JJ's 2026-09-29 decisions change.
branch: feat/avery-accounts-pay-plan
decision board: vault projects/little-games/2026-09-28-pricing-and-stripe-options.html (round 2)
JJ setup guide: vault projects/little-games/2026-09-29-avery-pay-jj-setup-steps.html
change list: /Users/joyd/lg-scans/plan-v3-changes.md
---

# Avery accounts and pay: build plan (version 3)

## In one minute

- **One free round, then pay.** On her own device, without signing in, a teacher gets exactly ONE free round in each of the six games (the vocab app counts as one game). After that the game says "Sign in and subscribe to keep playing". There is no free plan and no free trial.
- **Paid = everything:** $29 a year or $4.99 a month. All six games and every mode, unlimited saved lists, classes with class codes, play history, the 1-hour class ranking, the Tianzige Generator and the Chinese writing-pack engine. The **yearly** plan also includes the brand's printable packs (after a licence check) and a "Tell us what you need" request button.
- **Sign in with Google** to subscribe. Her lists, classes, history and subscription follow her to any device. Two teachers' data never mix.
- **Kids** never sign in, never see a paywall or a price, and never load analytics. They type only a nickname to join a room, as today.
- **One service, avery-hub** (already built on staging), owns sign-in, the teacher database, Stripe, downloads and the answer to "may this teacher start this round?". Each game stays its own Worker and asks the hub.
- **Money** goes through the existing **Ownly Network LLC** Stripe account; bank statements say **AVERY STUDIO**.
- **Schedule (with 20% contingency):** about 19 working days from now to live if slices run in parallel sessions (15.5 base), about 37 with one session at a time (31 base), plus JJ-side waits (Google consent-screen publishing, Stripe access, the tax check).

Claim grades: **A** = read today in the named source, **B** = standard platform behaviour not re-read today, **C** = estimate or judgement.

## For JJ first (only you can do these)

| # | Item | Why it blocks | How |
|---|---|---|---|
| 1 | **Google Cloud: staging and production projects, consent screens, OAuth clients** | No teacher can sign in anywhere until these exist; the staging hub answers "Can't sign in right now" today (A, S1 build report) | Step-by-step in the setup guide `projects/little-games/2026-09-29-avery-pay-jj-setup-steps.html` (vault) |
| 2 | **Stripe account access: a test-mode restricted key now, a live one at S5, and a read key for the webhook inventory** | S2a-fix and S2b cannot touch real Stripe test mode without it; no real Stripe call has been made yet (A, S2a build report) | Same setup guide |
| 3 | **Accountant tax check** for Ownly Network LLC: home state, whether a digital teaching subscription (now including printable packs) is taxable there, product tax code, any registrations | Live mode (S5) waits on it; the plan does not guess any of these | Same setup guide; send the accountant the "Tax gate" section below |

Owner items that are not blockers today (listed under Open questions): the one-day font and art licence check for the packs, the two placeholders on the legal page (mailing address, governing-law state).

## Decisions this plan builds on

| # | Decision | Who, when | Where it lands |
|---|---|---|---|
| 1 | Teachers sign in with Google (school or personal Gmail), stay signed in, and get a profile: lists, classes, history, subscription. Different teachers' data must never overlap. Kids never sign in and never see a paywall. | JJ, 2026-09-28 | S1 (built) |
| 2 | One Stripe account, Ownly Network LLC. Avery Studio is part of it. Seller for tax is Ownly Network LLC. | JJ, 2026-09-28 | S2a, S2b, S5 |
| 3 | A yearly and a monthly plan run as a pricing test with the thresholds below. (Prices and the free tier are replaced by rows 9 and 10.) | JJ, 2026-09-28 | pricing test |
| 4 | ~~Free mode may switch with a cooldown and a taste round a day.~~ **Superseded by row 9.** | JJ, 2026-09-28 | none |
| 5 | Teacher-side product analytics matter. Teacher screens only, never kid screens, no child data. AEO is a separate later track. | JJ, 2026-09-28 | S4 |
| 6 | Student rankings students can see (1-hour board; long-term board blocked, see "Rankings"). | JJ, 2026-09-28 | S3 |
| 7 | ~~Unlimited anonymous free-mode play.~~ **Superseded by row 9.** | commander, 2026-09-28 | none |
| 8 | The paid gate moves ahead of the brief's order (brief priority 5, A, `docs/avery/AVERY-CLASSROOM-GAMES-PICKUP.md` line 50). | JJ, 2026-09-28 | whole plan |
| 9 | **Hard paywall, no free tier.** "If they don't pay, then don't play." One free round per game per device without signing in (vocab app = one game), then "Sign in and subscribe to keep playing". No calendar trial. | JJ, 2026-09-29 | "Gate", S1-fix, S2b, S2c, S2d |
| 10 | **$29.00 a year (`avery_yearly_v2`) or $4.99 a month (`avery_monthly_v2`).** v1 prices are never created in live mode; in test mode any v1 objects are archived, not deleted. | JJ, 2026-09-29 | "Stripe", S2a-fix |
| 11 | **Paid = everything** listed in "In one minute"; yearly adds the printable packs (single-teacher licence, her name in the PDF footer) and the request button (1 a month, filled by hand, 60-day pilot). | JJ, 2026-09-29 | "Materials", S6 |
| 12 | **Refunds:** yearly, full refund within 14 days of the first purchase and of each renewal, and a refund ends access at once; monthly, cancel any time, no refund. 7-day grace after a cancel at period end, only when the teacher asked for the cancel. | JJ, 2026-09-29 | `accessFor`, S2a-fix |
| 13 | **Hosting:** all six games on `*.averystudio.org`; hub production `hub.averystudio.org`, staging `avery-hub-staging.joyd-ai-2026.workers.dev`. Support `hello@averystudio.org`. Legal page `https://www.averystudio.org/legal/policies` (`#terms #privacy #children #refunds`, joydong.org PR #88). House rule reword: little-games PR #24, merges before the hub. | JJ, 2026-09-29 | "Environments", S0c, S5 |
| 14 | **One live game session per game per hub session:** a new hand-off for the same game and hub session ends the previous game session for that game. | JJ, 2026-09-29 (answering the S1 coverage review's open point) | "One token protocol", S1-fix |

**Kept from version 2, for the law.** JJ asked for a nickname plus a device id, remembered for 1 hour or long term. A device id that lives in the browser links a child across rooms and days, which the FTC treats as personal information unless it is used only to run the service (A, FTC COPPA FAQ, read 2026-09-28). So the 1-hour board uses a **room-only participant id**, and the **long-term class ranking stays BLOCKED** until a school and parent notice and consent path exists.

## Already built (not re-planned)

| Piece | Branch | State | Review status (A, review files in `/Users/joyd/lg-scans/`) |
|---|---|---|---|
| **S1 hub core** | `feat/avery-hub` (worktree `/Users/joyd/lg-hub`, head `441b022`) | 84 tests green, `tsc` clean, staging live at `avery-hub-staging.joyd-ai-2026.workers.dev`, D1 `avery_hub_staging` migrated. No real Google sign-in yet (no client). | Full panel ran: bug lens FIX-FIRST (2 must-fix bugs), coverage lens FIX-FIRST (6 missing tests), evidence lens SHIP, Codex FIX-FIRST (10 items). Fix round pending (S1-fix). |
| **S2a Stripe model** | `feat/avery-stripe-model` (worktree `/Users/joyd/lg-stripe`) | 86 tests green: REST client, CRM webhook verifier, `accessFor`, event routing, idempotency keys, idempotent setup script, refund and dispute runbooks. No real Stripe call made (no key). | Full 4-reviewer panel ran; a 21-item fix round is in progress (S2a-fix). |
| **S0b legal page and house rule** | joydong.org PR #88 (`/Users/joyd/jd-legal/legal/policies.html`); little-games PR #24 | Legal page written with `#terms #privacy #children #refunds`; two owner placeholders left. House rule reword: SHIP. | Two clean review rounds each. **The page still describes version 2** (free plan, taste round, 5-day switch, $39 and $6.99; A, `policies.html` lines 149-161 and 299-300), so it needs the S0c refresh below. |
| **Custom domains for the five little-games Workers** | little-games PR #23 | tianzige, trace-race, stroke-reveal, missing-stroke, dictation-dash live on `*.averystudio.org` (A, `custom-domains-report.md`). The vocab app's custom domain sits on its own branch `feat/custom-domain` (branch exists, A; state not checked, C). | per that PR |

S1 deviations from version 2 that this plan adopts (A, S1 build report): nullable `google_sub` with a CHECK, triggers for "unlink only the list id", `ON UPDATE CASCADE` on composite keys, a `room_passes` table, `teachers.manual_access_until`, session revoke by row delete, one TokenDO for token, OAuth state and pending sign-in, typed `DELETE` as the second delete confirmation, hub-only sign-in rate-limited by connecting address (held in memory only, never stored), a Node SQLite fake D1 in tests.

## Pricing test (the rules, written in)

They live in `avery-hub/config/pricing-test.json`, not in code; a report script (`avery-hub/scripts/pricing-test-report.ts`, agent-callable, built in S4) prints each rule as met or not met. Thresholds are unchanged from version 2; prices are now **$29.00 a year and $4.99 a month**.

| Rule | Threshold | Config key | Data source |
|---|---|---|---|
| When to judge | 60 days after live launch or 30 paying teachers, whichever comes later | `judge_after_days` (60), `judge_after_paying_teachers` (30) | Stripe |
| Keep both plans if | monthly ($4.99) is at least 20% of new paying teachers AND at least half of monthly teachers still pay after 3 months | `keep_monthly_min_share` (0.20), `keep_monthly_min_retention_3mo` (0.50) | Stripe |
| Drop monthly if | monthly is under 20% of new paying teachers, OR most monthly teachers cancel within 2 months | `drop_monthly_max_share` (0.20), `drop_monthly_cancel_2mo` (0.50) | Stripe |
| Revisit the $29 price if | fewer than 2 in 100 signed-in teachers who see the subscribe card start a checkout | `revisit_price_min_checkout_rate` (0.02) | PostHog `subscribe_card_shown` then `checkout_started`, per teacher |

The materials pilot has its own rules (section "Materials").

## Architecture

### The pieces

| Piece | Where | What it does | Talks to |
|---|---|---|---|
| **avery-hub** | this repo, `avery-hub/` (built, S1) | Google sign-in, hub and game sessions, D1, Stripe, webhooks, reconciliation, the paid gate, downloads, requests, admin tools | Google, Stripe, D1, R2, its Durable Objects, PostHog (server events), alert channel |
| **HubService** | `avery-hub/src/rpc/hub-service.ts` (built) | the only way a game reaches teacher data or the gate | game Workers, through a service binding |
| **TokenDO** | avery-hub (built) | one object per hand-off token, OAuth state or pending sign-in; burns it exactly once | HubService, sign-in flow |
| **BillingDO** | avery-hub (stub today, built in S2b) | one object per Stripe customer; that customer's Stripe events and checkouts, one at a time | webhook route, reconciliation cron, `/billing/*` |
| **D1** | bound to avery-hub only | teachers, sessions, game sessions, lists, classes, history, subscriptions, Stripe events, room passes, seat grants, requests, download log, admin log | avery-hub only |
| **R2 bucket `avery-packs`** (new, private) | bound to avery-hub only | the pack PDFs; never public, no `r2.dev` URL, no custom domain | avery-hub `/downloads` only |
| **Six game Workers** | vocab: repo `joydai2026-del/bilingual-vocab-game`; five in this repo | the games; each grants its own one anonymous round and asks HubService for every other round | HubService (service binding), kid devices |
| **Room Durable Object** (existing in each room game) | game Worker | holds the room, its room pass or anonymous pass, and the 1-hour ranking | kid devices, its game Worker |
| **Legal page** | `https://www.averystudio.org/legal/policies` (joydong.org repo) | terms, privacy, children, refunds | linked from the hub, games, Checkout and Google's consent screen |

Caption Wars is not an Avery game (not in `GAME_REGISTRY`, A) and is not gated.

### The internal API is RPC only (never public)

Unchanged from version 2 and built in S1 (A, S1 build report, `public-surface.test.ts`):

- The hub's default `fetch` handler serves only `/auth/*`, `/me`, `/me/*`, `/billing/*`, `/downloads/*`, `/stripe/webhook` and `/admin/*`. It has no `/internal/*` route; `/internal/*`, `/rpc`, `/HubService` and every method name return 404.
- **Admin routes.** Production `hub.averystudio.org` only, with `workers_dev: false` and `preview_urls: false`; staging on its `workers.dev` name. A Cloudflare Access application covers `/admin/*` on every hub hostname, and the hub itself verifies the `Cf-Access-Jwt-Assertion` (signature, issuer, `aud`), else 403, failing closed when the Access config is empty. The admin 403 test loops over every hostname the hub answers, including a staging version preview host (coverage-review item, S1-fix).
- Games call a **named** `WorkerEntrypoint`, `HubService`, through a service binding with `"entrypoint": "HubService"` (A, https://developers.cloudflare.com/workers/runtime-apis/rpc/). Every method takes `{ gameId, gameKey }` first; the hub checks it against `GAME_REGISTRY` (game id, return URLs, hashed game key, allowed methods, modes). Every game session and room pass records its game id; a call from game X with game Y's session or pass is refused.

HubService methods (version 3):

| Method | Purpose | Needs |
|---|---|---|
| `redeemHandoff(caller, token, bindingValue)` | swap a one-time hand-off token for a game session; **ends the previous game session of the same game and hub session** | token bound to this game and browser |
| `resolveSession(caller, gameSessionId)` | who is this, is the session valid | game session of this game |
| `entitlement(caller, gameSessionId)` | `{ access: "paid" \| "none", plan: "yearly" \| "monthly" \| "grant" \| null, until, email }`, for the screen only | game session |
| `authorizeRound(caller, gameSessionId or null, mode, roomCode or null)` | the server decision for one paid round start; returns a round grant | see "Gate" |
| `listLists / getList / saveList / deleteList` | her saved lists (paid only) | game session, paid |
| `listClasses / saveClass / deleteClass` | her classes and class codes (paid only; `listClasses` also checks paid, Codex S1 item 5) | game session, paid |
| `mintRoomPass(caller, gameSessionId, roomCode)` | room pass for a paid teacher's room | game session, paid |
| `checkRoomPass(caller, passId)` | still good? answers `valid` or `revoked`; any `valid: false` means "stop paid rounds" | pass of this game |
| `signOut(caller, gameSessionId)` | end this device's hub session and its game sessions | game session |
| ~~`useTaste`, `switchFreeMode`~~ | **retired** (decision 9). Removed from every game's `methods` list in `GAME_REGISTRY`; the method bodies return `refused: retired` until a later release deletes them | none |

### One token protocol

| Piece | Rule |
|---|---|
| Pre-set binding cookie | Before sending the teacher to the hub, the game sets `__Host-avery_bind` = 32 random bytes (Secure, HttpOnly, SameSite=Lax, 10 minutes) and passes only its SHA-256 hash to `hub/auth/start?game=<id>&bind=<hash>`. This is the login-CSRF defence. |
| Hand-off token | 32 random bytes, opaque. Sent in the URL fragment (`game/auth/finish#t=...`); the page posts it to its own Worker and clears the address bar. |
| At rest | Only `HMAC-SHA256(SESSION_HASH_KEY_v<N>, token)` with key version `N`, in a TokenDO named by that hash: hub session id, teacher id, game id, bind hash, created, expires, key version, used flag. **OAuth state and pending device-picker values also carry their key version** (Codex S1 item 7, S1-fix). |
| Redemption | `redeemHandoff` goes to the TokenDO, which burns the token first and then checks game id, bind value (constant time), expiry (`HANDOFF_TOKEN_SECONDS` 60). An unset current hash key returns `unavailable`, never a thrown error after the burn (bug-lens F8). |
| Game sessions | Minted and stored by the hub. `game_sessions` row: id hash, key version, hub session id hash, teacher id, game id, created, last used, absolute expiry. The game cookie `__Host-avery_game` holds only the random id. |
| **One live game session per game per hub session** | `redeemHandoff` deletes any existing `game_sessions` row with the same `hub_session_id_hash` and `game_id` and inserts the new one **in one batch**. A second tab of the same game in the same browser therefore shares the newest session; an older copied cookie stops working. Test: redeem twice for one game and hub session; the first game session is refused by every method; a game session of a different game is untouched. |
| Revocation | Ending a hub session ends every game session made from it. Sign out everywhere, the device limit, JJ's revoke and account deletion all act in the hub. A hand-off token minted before "sign out everywhere" cannot be redeemed after it (coverage-review test, S1-fix). |
| Lifetimes | Hub session: idle `SESSION_IDLE_DAYS` (30), absolute `SESSION_MAX_DAYS` (90), rotated every `SESSION_ROTATE_DAYS` (7). A request that loses the rotation race re-resolves the session instead of carrying the dead id (bug-lens F4, S1-fix). Game session: absolute `GAME_SESSION_HOURS` (12), idle `GAME_SESSION_IDLE_HOURS` (4). |
| CSRF on actions | POST only, `Origin` checked against the allowlist, SameSite=Lax cookies, per-session CSRF token on hub forms. **Hub pages send `Referrer-Policy: same-origin`, not `no-referrer`**, because a `no-referrer` page makes the browser send `Origin: null` and every hub form was refused (bug-lens F1, A on staging). |
| Rate limits | Cloudflare rate-limiting binding (B). Keys: bind hash and game id, **plus** a connecting-address bucket held only in the limiter's memory, never stored (Codex S1 item 1, bug-lens F6). **Separate namespace ids for staging and production** (Codex S1 item 6). `AUTH_START_PER_MINUTE` (20), `REDEEM_PER_MINUTE` (20). |
| Key rotation | `SESSION_HASH_KEY_V1`, `SESSION_HASH_KEY_V2`, `SESSION_HASH_KEY_CURRENT`; the version travels in every value (`v2.<random>`). Rotation never logs everyone out. |

### Sign-in and hand-off flow

Unchanged from version 2 and built in S1: game sets the binding cookie, hub runs Google's server flow with `state`, `nonce`, scopes `openid email profile` and `prompt=select_account` (A for the flow, https://developers.google.com/identity/openid-connect/openid-connect), finds or creates the teacher by Google `sub`, applies the device limit, mints the hand-off token, the game redeems it and shows "Signed in as x@school.org" on the teacher screen, on the subscribe card and before checkout. **Device limit** `MAX_TEACHER_DEVICES` (3) with a "which device to sign out" picker; the limit check and the session insert become one conditional statement (bug-lens F5, S1-fix). "Sign out" ends this browser's hub and game sessions and says she is still signed in to Google; "Sign out everywhere" ends all of them.

### Google environments

| Item | Staging | Production |
|---|---|---|
| Hub address | `https://avery-hub-staging.joyd-ai-2026.workers.dev` | `https://hub.averystudio.org` |
| Google Cloud project and OAuth client | separate staging project and client (JJ, For JJ item 1) | separate production project and client |
| Exact callback URIs | `https://avery-hub-staging.joyd-ai-2026.workers.dev/auth/callback`, `http://localhost:8787/auth/callback` | `https://hub.averystudio.org/auth/callback` only |
| Consent screen | Testing: listed test users only, capped at 100 (B) | Published (JJ step, S5): needs the home page, `https://www.averystudio.org/legal/policies` and the verified domain; scopes `openid email profile` only; brand review can take days (B) |
| Game return URLs | staging game Workers | the six `*.averystudio.org/auth/finish` URLs (A, `GAME_REGISTRY`) |

Staging's `localhost` return URL moves to a `dev` environment only (bug-lens F10, S1-fix).

### When the hub is down or broken

Rule: anything that saves, spends or unlocks **fails closed**. The one anonymous round never needs the hub. A room already authorized keeps going on its bounded room pass.

| Moment | What the teacher sees | What the system does |
|---|---|---|
| Sign-in or hand-off | "Can't sign in right now. Please try again in a few minutes." | no game session is made |
| Her one free round (anonymous) | nothing changes | the game Worker grants it by itself (section "Gate") |
| Starting a paid round, no room pass | "We can't check your subscription right now. Please try again in a minute." | `authorizeRound` unreachable, so the round is refused |
| Room already open with a paid room pass | nothing changes | the Room DO allows rounds on its pass until it expires (`ROOM_PASS_HOURS` 4); rooms today are deleted 2 hours after creation (A, vocab `room-do.ts` line 70), so 4 hours never cuts a lesson short |
| Room pass re-check at round start | nothing changes | hub answers `valid: false` (revoked, unknown, expired): paid rounds stop and the teacher screen shows the subscribe message; hub silent: the stored pass decides until it expires |
| Saving a list | "Can't reach your lists right now. Your list is still here; try again in a minute." | draft stays in session storage |
| Checkout return | "We're confirming your payment; it can take a minute." | the one-time checkout code stays valid `CHECKOUT_CODE_MINUTES` (60); reconciliation finishes it |
| Download | "Can't get that file right now. Please try again in a minute." | nothing is served |
| Stripe webhook | nothing | Stripe retries live events for up to 3 days (A, board source docs.stripe.com/webhooks); reconciliation also catches it |

Tests: for each row, the HubService binding is replaced with one that throws, and the expected result is asserted.

**Room pass fields:** pass id, game id, room code, teacher id, allowed modes, entitlement version, issued, expires. Stored in the Room DO in its own storage slot, never sent to any device. Revocation: refund, dispute, cancel-now, admin revoke, account deletion and a teacher move bump `entitlement_version`, and `checkRoomPass` then says `revoked`. **Pass rows are kept on tombstone and move** (the version bump revokes them; the rows hold no personal data) and removed by the expiry clean-up (bug-lens F2, S1-fix). `mintRoomPass` is one conditional insert that checks paid access and the expected entitlement version in the same statement (Codex S1 item 3).

## Data model and per-teacher isolation

### Tables (D1)

`migrations/0001_init.sql` is built (A). Version 3 adds `migrations/0002_v3.sql` (additive only).

| Table | Key and constraints | Main columns | v3 change |
|---|---|---|---|
| `teachers` | `id` PK; `google_sub` UNIQUE, nullable only for a tombstone (CHECK); `stripe_customer_id` UNIQUE; `analytics_id` UNIQUE | `email`, `display_name`, `entitlement_version`, `manual_access_until`, `created_at`, `last_seen_at`, `deleted_at` | `free_game`, `free_game_locked_until`, `taste_day`, `taste_used` are **deprecated**: kept (nullable, or `taste_used` with its default 0), never read or written from S1-fix on, dropped by a later migration after one release with no reader. Never a destructive migration in the same release. |
| `sessions` | `id_hash` PK; FK `teacher_id` CASCADE; `UNIQUE(teacher_id, id_hash)` | `key_version`, `browser_label`, `created_at`, `rotated_at`, `last_used_at`, `absolute_expiry`, `revoked_at` | none |
| `game_sessions` | `id_hash` PK; composite FK (`teacher_id`, `hub_session_id_hash`) to `sessions` CASCADE, ON UPDATE CASCADE | `game_id`, `key_version`, `created_at`, `last_used_at`, `absolute_expiry`, `revoked_at` | new unique index `(hub_session_id_hash, game_id)` backs decision 14 |
| `lists`, `classes`, `round_history` | as built (composite FKs, unlink triggers) | as built | none |
| `room_passes` | as built | as built | kept on tombstone and move (S1-fix) |
| `subscriptions` | PK `stripe_subscription_id`; FK `teacher_id` RESTRICT | `price_id`, `status`, `current_period_end`, `cancel_at_period_end`, `latest_charge_id`, `refunded_full`, `dispute_state`, `access_until`, `synced_at` | new `plan_interval` (`year`, `month`), `cancel_requested_by_teacher` (0 or 1) |
| `stripe_events`, `billing_ops`, `checkout_codes`, `seat_grants`, `admin_log` | as in version 2 | as in version 2 | none |
| `requests` (new) | `id` PK; FK `teacher_id` CASCADE; index (`teacher_id`, `created_at`) | `text`, `status` (`new`, `in_progress`, `sent`, `declined`), `issue_number`, `created_at`, `updated_at` | new (S6) |
| `pack_downloads` (new) | `id` PK; FK `teacher_id` CASCADE; index (`teacher_id`, `at`) | `pack_id`, `pack_version`, `at` | new (S6), for the daily cap and the licence record |

Every foreign key has an explicit delete rule. **Deleting a teacher is a tombstone:** the row keeps only `id`, `stripe_customer_id` and `deleted_at`; email, name, `sub`, `analytics_id`, `created_at` and `last_seen_at` are nulled or zeroed; her lists, classes, history, sessions, game sessions, requests and download log are deleted; a seat grant attached to her has its `email` replaced by a hash (Codex S1 item 8). `moveTeacher` runs with `PRAGMA defer_foreign_keys = on` first in its batch (bug-lens F3). Billing rows stay (Ownly Network LLC needs them for tax). No kid data is stored in D1.

D1 enforces foreign keys, and "Batched statements are SQL transactions" (A, https://developers.cloudflare.com/d1/worker-api/d1-database/, read 2026-09-28). Separate D1 calls are not one transaction, so every read-then-write rule is one conditional statement or one batch.

### The isolation rule (built, A)

1. All SQL lives in `avery-hub/src/db/`; nothing else touches `env.DB`.
2. Teacher data only through `forTeacher(db, teacherId)`; every statement binds `teacher_id = ?1`.
3. `teacherId` comes only from a session the hub resolved; no body, query, header or RPC argument can set it.
4. Admin code lives in `src/admin/`, reachable only from `/admin/*`; a test fails if teacher code imports it.
5. **New:** the paid check sits inside the same statement as every paid write or read (`saveList`, `listLists`, `listClasses`, `mintRoomPass`, request insert, download log insert), so a revoke between check and write cannot slip through (Codex S1 items 3, 4, 5). HubService catches every error at its boundary and returns a typed code, never provider text or a stack (Codex S1 item 9, bug-lens N5).

### Atomic writes

| Rule | How |
|---|---|
| Hand-off token burn | inside the TokenDO |
| One game session per game per hub session | `DELETE` then `INSERT` in one batch |
| Checkout code burn | conditional `UPDATE ... WHERE used_at IS NULL AND expires_at>?`, exactly 1 row |
| Saved list (paid only) | `INSERT INTO lists ... SELECT ... WHERE <paid predicate for ?teacher at ?now>`, exactly 1 row |
| Room pass | `INSERT INTO room_passes ... SELECT ... WHERE <paid predicate> AND entitlement_version = ?expected`, exactly 1 row |
| Request (1 a month) | `INSERT INTO requests ... SELECT ... WHERE <yearly predicate> AND (SELECT COUNT(*) FROM requests WHERE teacher_id=?1 AND created_at > ?monthStart) < ?REQUESTS_PER_MONTH` |
| Download cap | `INSERT INTO pack_downloads ... SELECT ... WHERE <yearly predicate> AND (count today) < ?DOWNLOADS_PER_DAY`; the file is served only after 1 row changed |
| Webhook claim and effect | serialized in BillingDO; state write and "processed" mark in one batch |

Tests fire 10 concurrent requests for each row and assert exactly the allowed number succeed.

### Isolation tests (every deploy; a failure blocks the deploy)

Built in S1 (A): A against B's ids on every table and method, injected teacher ids ignored, composite keys hold, two Google accounts in one browser do not mix, login CSRF refused, token replay refused, sign-out everywhere refused by every method, admin not importable. S1-fix adds the coverage lens's six missing tests (sign-out RPC and page, pre-minted token after sign-out everywhere, admin 403 on every hostname and verb, and the rest listed in `review-s1-claude-coverage.md`) and a POST test built the way a browser sends it after loading the page (bug-lens N6). S6 adds: A cannot download under B's name, A cannot read B's requests, a stamped PDF carries only the downloading teacher's name.

## The gate (every game, server-side)

### The rule

A round starts only with **(a)** an anonymous taste grant, or **(b)** a paid grant.

| | (a) Anonymous taste | (b) Paid |
|---|---|---|
| Who | anyone, no sign-in | a signed-in teacher with paid access (subscription, seat grant or JJ's manual grant) |
| How many | `ANON_FREE_ROUNDS_PER_GAME` (1) per game per browser; the vocab app's modes count as one game | unlimited |
| Who decides | the game Worker, alone (works with the hub down) | the hub: `authorizeRound`, or an unexpired room pass minted for a paid teacher |
| Proof it was used | the game sets `__Host-avery_taste_<gameId>` (Secure, HttpOnly, SameSite=Lax, `Path=/`, Max-Age 400 days) **after** granting | the round grant id returned by the hub |
| Next time | a request carrying that cookie is refused with "Sign in and subscribe to keep playing" | n/a |

**Honest limit (stated plainly):** clearing cookies, a private window or another browser gives another free round. That is accepted. The real wall is (b): saved lists, classes, history, rankings across rounds, packs, and any second round in the same browser all need a paid grant. Nothing about the anonymous visitor is stored on our servers.

`TRIAL_DAYS` stays in config at 0, so a calendar trial can come back without code. `ANON_FREE_ROUNDS_PER_GAME` at 0 removes the free round.

### Rooms

| Moment | Teacher's screen | Kids' tablets |
|---|---|---|
| Anonymous teacher opens a room | normal lobby | normal join |
| Its one round | plays normally | play normally |
| After that round | "The teacher needs to subscribe to keep playing" with a "Sign in and subscribe" button | "Round over", and nothing about money, prices or subscribing |
| Paid teacher's room | every mode, every round, on the room pass | as today |
| Paid pass revoked mid-lesson (refund, dispute, admin) | the current round finishes; the next start shows the subscribe message | "Round over" |

The anonymous room gets an **anonymous pass** in its Room DO: `{ kind: "anon", roundsLeft: ANON_FREE_ROUNDS_PER_GAME }`. The taste cookie is set on the browser that asked for the round (the teacher's). A kid's player id can never start a round beyond what the pass allows, so kids cannot keep an anonymous room going (vocab lets a player id start a round today, A, `src/worker/index.ts` line 16).

### Per-game integration steps (the same for every game)

1. **Binding.** In the game's `wrangler.jsonc`: a service binding `HUB` to `avery-hub` with `"entrypoint": "HubService"` (staging binds `avery-hub-staging`); vars `GAME_ID`, `ANON_FREE_ROUNDS_PER_GAME`, `ROOM_PASS_HOURS`; secret `HUB_GAME_KEY`. The hub gets that key's hash in `GAME_REGISTRY.<id>.keyHash` (empty for all six today, A, S1 build report open item 2).
2. **Hand-off.** New routes `GET /auth/finish` (page that posts the fragment token and clears the address bar) and `POST /api/auth/redeem` (calls `redeemHandoff`, sets `__Host-avery_game`, clears `__Host-avery_bind`), `POST /api/auth/signout`, and `GET /api/me` (calls `entitlement`, teacher screens only).
3. **`POST /api/round/start {mode, roomCode?}`.** Order: (i) game cookie present, then `authorizeRound`; paid gives a grant, "not paid" gives the subscribe message; (ii) no game cookie: taste cookie present gives the subscribe message; (iii) otherwise grant the anonymous round and set the taste cookie. Every existing round-start route below calls the same function, so no path skips the gate.
4. **Room pass.** Room creation stores a pass in the Room DO: `mintRoomPass` for a paid teacher, the anonymous pass otherwise. Every round start inside the room checks the pass (and `checkRoomPass` when the hub answers).
5. **Screens.** Teacher screens only: "Sign in with Google", "Signed in as ...", the subscribe card ($29 a year or $4.99 a month, "renews automatically, cancel any time", "Billed by Ownly Network LLC as AVERY STUDIO"). Kid screens never show any of it; a test opens every kid route and asserts no price, no "subscribe", no sign-in button.
6. **Tests per game:** first anonymous round granted and cookie set; second refused; cookie present plus paid session granted; hub throwing: anonymous round still works, paid round refused, room with a live pass continues; kid player id cannot start a round past the pass; agent path (below).

### The six games

Read today in `/Users/joyd/lg-hub/<game>/` at `441b022` and the vocab repo `main` at `77e490f` (A unless marked).

| Game (`GAME_ID`) | Repo | Worker name | Round-start routes to gate | Room path | Notes |
|---|---|---|---|---|---|
| Vocab app (`vocab`) | `joydai2026-del/bilingual-vocab-game` | `bilingual-vocab-game` | new `POST /api/round/start` for single-screen modes (memory, reveal, sky-tower, tone, listen, echo, whack run in the browser today); `POST /api/rooms/:code/round` (kinds race, climb, dash, tower; host key or player id, line 16) and the legacy `/start` alias (line 19) | `POST /api/rooms` (both the `{set, teacher}` path and the legacy `{set, questions, perQuestionMs}` path, lines 13-14); `src/worker/room-do.ts` | `ROOM_TTL_MS` is hard-coded at line 70; moves to config. No custom domain on `main` (A); branch `feat/custom-domain` exists (state C). Server-built questions for paid single-screen rounds as in version 2. |
| 田字格 Tianzige Generator (`tianzige`) | little-games `tianzige-generator/` | `tianzige-generator` | new `POST /api/round/start` (mode `main`) before the preview and Print button are enabled (the sheet renders in the browser today, `src/client/main.ts` lines 46-60); `POST /api/sheet` (server-rendered sheet, the agent path) needs the same grant | none (no rooms) | one "round" = one sheet |
| Trace Race (`trace-race`) | little-games `trace-race/` | `trace-race` | `POST /api/rooms/:code/start`, `POST /api/rooms/:code/next` | `POST /api/rooms`; `src/worker/room-do.ts` | no solo path found (grep, B) |
| Stroke Reveal (`stroke-reveal`) | little-games `stroke-reveal/` | `stroke-reveal` | `POST /api/rooms/:code/start`, `POST /api/rooms/:code/next` | `POST /api/rooms`; `src/worker/room-do.ts` | no solo path found (grep, B) |
| Missing Stroke (`missing-stroke`) | little-games `missing-stroke/` | `missing-stroke` | `POST /api/rooms/:code/start`, `/next`; new `POST /api/round/start` before `#/solo`, which runs the whole game on the phone (`src/client/solo.ts`) | `POST /api/rooms`; `src/worker/room-do.ts` | solo = one round per start |
| Dictation Dash (`dictation-dash`) | little-games `dictation-dash/` | `dictation-dash` | `POST /api/rooms/:code/start`, `/next`; solo is a room made with `mode: "solo"` (`src/client/api.ts` line 88), so it is gated at room creation | `POST /api/rooms`; `src/worker/room-do.ts` | paid speech budget (`budget-do.ts`) unchanged |

**Residual risk, stated honestly (B):** where a game runs in the browser (vocab single-screen modes, Tianzige preview, Missing Stroke solo), someone who rewrites our JavaScript can play without a grant. They get no rooms beyond one round, no saved lists, no classes, no history, no packs. That is the same limit every browser game has.

**Agent-native:** an agent still joins any room through the same HTTP API as a kid, ungated. An agent hosting rounds gets the same one anonymous round per game, then needs a paid path; the teacher-issued API key through the hub stays a follow-up (known gap under the house agent-native rule).

## Stripe

### Objects (idempotent setup script, built in S2a, A)

| Object | Value | Config key |
|---|---|---|
| Product | "Avery Classroom Games", `statement_descriptor` = `AVERY STUDIO`, metadata `app=avery` | `STRIPE_PRODUCT_ID` |
| Price, yearly | **$29.00 USD every year, lookup key `avery_yearly_v2`** | `STRIPE_PRICE_YEARLY` |
| Price, monthly | **$4.99 USD every month, lookup key `avery_monthly_v2`** | `STRIPE_PRICE_MONTHLY` |
| Webhook endpoint | `https://<hub>/stripe/webhook`, the 11 events below, API version pinned `2026-08-26.dahlia` (B, S2a report) | `STRIPE_WEBHOOK_SECRET` |
| Portal configuration | cancel at period end, update card, invoice history; plan switch and cancel-now off | `STRIPE_PORTAL_CONFIG_ID` |

**v1 prices ($39, $6.99):** never created in live mode. In test mode the setup script looks up `avery_yearly_v1` and `avery_monthly_v1`; if found it sets them `active: false` (archive; prices cannot be deleted once used, B) and prints that in the readback. It never deletes anything. Lookup keys and amounts come from config, not code, so a later v3 price is a config change plus a setup run.

`scripts/stripe-setup.ts` refuses a live key for staging, needs `--live --i-have-read-the-tax-gate` plus a live key for live mode, finds before creating, never touches non-Avery objects and never prints the webhook secret (A, S2a report). Stripe test and live objects are separate (B), so production is provisioned in test mode until S5 and in live mode in S5.

### Branding inside the Ownly account (honest limits, unchanged)

| Surface | What the teacher sees | Grade |
|---|---|---|
| Bank or card statement | `AVERY STUDIO` from the product's `statement_descriptor` (subscription payments only; banks vary) | A (docs.stripe.com/api/products/object, docs.stripe.com/get-started/account/statement-descriptors, read 2026-09-28) |
| Top of Checkout | "Avery Studio" via `branding_settings.display_name`; the business name still appears in terms and receipts | A (docs.stripe.com/api/checkout/sessions/create, read 2026-09-28) |
| Receipts, Customer Portal, Checkout terms | Ownly Network LLC; line item "Avery Classroom Games" | A for receipts and terms, B for the portal |

### Customer mapping and no double purchase (unchanged)

One Stripe customer per teacher (`metadata.teacher_id`, key `customer:<teacher_id>`, `stripe_customer_id` UNIQUE); Checkout Session with `customer`, `client_reference_id`, `subscription_data.metadata.teacher_id`, `metadata.app=avery`. `/billing/checkout` runs inside her BillingDO, refuses while any subscription is not `canceled` or `incomplete_expired` and sends her to the portal, and returns an unexpired open session instead of a second one. Two active subscriptions anyway: reconciliation alerts JJ. Every mutating call carries an idempotency key (`checkout:`, `customer:`, `refund:`, `cancel:`; built in S2a, A).

### Webhook processing (serialized per customer, unchanged)

Events: `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.

1. Verify the signature on the raw body (CRM verifier, built). Failure is 401.
2. Decide "is this Avery's" **by customer**: subscription, invoice and checkout events by `customer`; refunds by the charge's customer; disputes by retrieving the dispute's charge (built as `resolveCustomer`, A). Not a known teacher: recorded `not_avery`, 200.
3. `INSERT OR IGNORE` the event as `received`; already `processed`: 200.
4. `enqueue(eventId)` on that customer's BillingDO, which writes it to its own durable storage and sets an alarm before returning; only then 200.
5. The DO processes its queue one event at a time: fetch the latest subscription, latest charge and any dispute; compute `accessFor`; write the subscription row, bump `entitlement_version` if access dropped, mark processed, all in one `db.batch()`; then remove it from the DO queue.
6. On error: stays queued, `attempts + 1`, backoff from `WEBHOOK_RETRY_BASE_SECONDS` (30) to 1 hour; the hourly cron re-enqueues D1 rows still `received` or `failed` after 10 minutes.
7. `attempts >= ALERT_AFTER_ATTEMPTS` (3) sends an alert.

Crash tests as in version 2 (kill the DO before the batch; delete the DO queue entry and let the D1 backstop finish it).

### State model: `accessFor` (built in S2a; S2a-fix applies the v3 rows)

`accessFor(subscription, latestCharge, dispute, refundOps, now, policy)` returns `{ access, plan, until, reason }`; `plan` is `yearly` or `monthly` from the price's interval.

| Input state | Access | Config |
|---|---|---|
| `incomplete`, `incomplete_expired` | none | none |
| `trialing` | paid until `trial_end` (only if someone sets a trial in the Dashboard; `TRIAL_DAYS` is 0) | `TRIAL_DAYS` (0) |
| `active`, renewing | paid until `current_period_end` + `RENEWAL_SLACK_HOURS` (24, C), so a late renewal webhook never locks out a paying teacher | `RENEWAL_SLACK_HOURS` |
| `active` with `cancel_at_period_end`, **teacher asked** (`cancellation_details.reason` = `cancellation_requested`, B) | paid until period end + 7 days | `ACCESS_END_GRACE_DAYS` (7) |
| `active` with `cancel_at_period_end`, any other cause | paid until period end, no grace | none |
| `past_due` | paid during grace | `PAST_DUE_GRACE_DAYS` (7) |
| `unpaid`, `paused`, `canceled` | none | none |
| latest paid charge **fully refunded** (even if the subscription says `active`) | none, at once | none |
| partial refund | no change | none |
| dispute open | none while open | `DISPUTE_ACTION` (pause) |
| dispute won | back to what the subscription says | none |
| dispute lost | none; subscription cancelled | none |

Seat grants and JJ's manual grants give `plan: "grant"`, which counts as yearly for packs and requests (`GRANT_COUNTS_AS` = `yearly`, C).

**Refunds never get re-granted:** the ordered refund-then-cancel workflow (refund, cancel now with no proration, mark `refunded_full` and bump `entitlement_version`), each step in `billing_ops` and safe to re-run; a Dashboard refund triggers steps 2 and 3 through `charge.refunded`; reconciliation never clears `refunded_full` or an open dispute from a subscription fetch alone; a lost dispute cancels the subscription (built runbooks: `docs/ops/refund.md`, `dispute.md`, A).

### Reconciliation (daily, `RECONCILE_HOUR_UTC`, unchanged)

Lists Stripe's subscriptions for both v2 prices (all statuses) and maps them by `metadata.teacher_id`; lists refunds and disputes from the last 35 days, resolved to customers as in step 2; runs each customer through its BillingDO; alerts on any fix, two active subscriptions, an unknown Avery subscription, a still-billing tombstone (once per subscription), or a missed run by `RECONCILE_HOUR_UTC` + 2 hours.

### Alert channel (changed: private repo)

A GitHub issue opened with a fine-grained token that can only write issues in **one private repo** (`ALERT_GITHUB_REPO`, proposed `joydai2026-del/avery-ops`, created in S2b). **Not this repo: `joydai2026-del/little-games` is PUBLIC (A, `gh repo view`, 2026-09-29)**, so version 2's "issue on this repo" would have published teacher ids, subscription ids and request text. Labels `avery-alert` (`avery-alert-staging` on staging) and `avery-request`. Issue bodies carry only ids and a hub admin link, never an email, name or request text. GitHub's notification email reaches JJ. `ALERT_CHANNEL` and `ALERT_GITHUB_REPO` are config.

### Existing webhooks on the Ownly account

Before the Avery endpoint is added, a read-only inventory of every endpoint on the Ownly Network LLC account (template built, `docs/ops/stripe-webhook-inventory.md`, A; needs JJ's read key). Any live endpoint that subscribes to charge or subscription events must ignore Avery objects (`app=avery`).

### Refund policy and economics

- Yearly: full refund within `REFUND_WINDOW_DAYS` (14) of the first purchase and of each renewal, no questions asked; a refund ends access at once. Monthly: cancel any time, no refund; access runs to the end of the paid month plus the 7-day grace when she cancelled.
- Monthly to yearly: portal plan switch is off; JJ does it from the Dashboard on request (runbook).
- Stripe does not return processing fees on refunds (A for "not returned", https://docs.stripe.com/refunds, read 2026-09-28); at $29 the lost fee is about $1.14 per refund (2.9% + 30 cents, C, standard US card pricing not re-read). S5 records the real fee lines from the first live charge.
- Receipts: successful-payment and refund receipts and the renewal reminder turned on (B); test-mode receipts are sent by hand only (B), so automatic delivery is proven on the first live purchase (S5). The subscribe card and Checkout `custom_text` say the plan renews automatically, its price, and how to cancel (C, US auto-renewal rules).

### Tax gate before live mode

Seller: Ownly Network LLC. Stripe Tax collects only where registrations have been added; the business decides where it owes tax (A, https://docs.stripe.com/tax/registering, read 2026-09-28). Before S5, JJ and her accountant confirm the home state, whether the subscription is taxable there (it now includes printable packs, which some states treat differently from a software service, C), the product tax code, and any registrations. This plan does not guess any of those.

### Secrets (names only; separate values for staging and production)

| Secret | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | restricted key; test until S5, live from S5 |
| `STRIPE_WEBHOOK_SECRET` | webhook signature (several `v1` values accepted during a roll, A) |
| `GOOGLE_CLIENT_SECRET` | Google sign-in |
| `SESSION_HASH_KEY_V1`, `SESSION_HASH_KEY_V2` | hash sessions, game sessions, tokens, checkout codes |
| `HUB_GAME_KEY` (each game) / its hash in `GAME_REGISTRY` (hub) | proves which game is calling |
| `ALERT_GITHUB_TOKEN` | alert and request issues in the private ops repo |
| `CF_ACCESS_SERVICE_TOKEN` (admin CLI only) | reach `/admin/*` |

Config, not secrets: `GOOGLE_CLIENT_ID`, `POSTHOG_PROJECT_KEY`, price ids and lookup keys, portal config id, `GAME_REGISTRY`, `PACKS`, every limit and grace period, `SESSION_HASH_KEY_CURRENT`, `ALERT_CHANNEL`, `ALERT_GITHUB_REPO`, `STRIPE_MODE`, `SUPPORT_EMAIL` (`hello@averystudio.org`, A in `wrangler.jsonc`).

### Config vars: kept, added, deprecated

| Var | State | Default |
|---|---|---|
| `ANON_FREE_ROUNDS_PER_GAME` | **new** (each game Worker and the hub, which reads it only for the screen) | 1 |
| `TRIAL_DAYS` | kept | 0 |
| `ACCESS_END_GRACE_DAYS`, `PAST_DUE_GRACE_DAYS`, `DISPUTE_ACTION`, `REFUND_WINDOW_DAYS` | kept (S2a merge notes, A) | 7, 7, pause, 14 |
| `RENEWAL_SLACK_HOURS`, `GRANT_COUNTS_AS` | new | 24, yearly |
| `REQUESTS_PER_MONTH`, `REQUEST_MAX_CHARS`, `DOWNLOADS_PER_DAY`, `PACK_FOOTER_TEMPLATE` | new (S6) | 1, 1000, 20 (C), "Licensed to {name} for one classroom. Please do not share." |
| `FREE_LIST_LIMIT`, `FREE_TASTE_ROUNDS_PER_DAY`, `FREE_MODE_SWITCH_COOLDOWN_DAYS`, `FREE_GAME_COUNT`, `FREE_GAME_CHOICES`, `ANON_FREE_ROUNDS`, `ANON_FREE_MODE` | **deprecated** (created in S1, A). S1-fix stops reading them and removes them from `wrangler.jsonc` in the same PR; the `wrangler-env.test.ts` "JJ defaults" test changes to the v3 defaults. No code path depends on them after S1-fix. | removed |

## Materials (yearly members)

### What is included

| Item | Plan | How it is delivered |
|---|---|---|
| Tianzige Generator, Chinese writing-pack engine | both plans | the Tianzige game (gated like every game); the engine's output is the packs below |
| The brand's printable packs | **yearly only**, after the one-day font and art licence check (owner item) | hub `/downloads`, stamped with her name |
| "Tell us what you need" | **yearly only**, 1 request a month | hub `/me/requests`; JJ fills it by hand |

### Packs config

`avery-hub/config/packs.json` (validated at startup; a bad entry fails the deploy test):

| Field | Example meaning |
|---|---|
| `id` | stable id, used in URLs and the download log |
| `title` | shown on the teacher's "Printable packs" page |
| `r2Key` | object key in the private bucket `avery-packs` |
| `version` | bumps when the file changes; logged per download |
| `licenceLine` | the licence sentence printed on the page and in the footer |
| `licenceChecked` | `true` only after the owner's font and art check for this pack; `false` packs are hidden |

### Downloads route

`GET /downloads` lists the packs (yearly or grant only; others see the subscribe card). `POST /downloads/<packId>` (Origin and CSRF checked, POST so a link cannot trigger it): resolve the hub session, check yearly access and the daily cap in the `pack_downloads` insert (one statement), read the PDF from R2, stamp the footer, return it with `Content-Disposition: attachment` and `Cache-Control: private, no-store`. Nothing is ever public in R2.

**How the footer is stamped (HOW decision, C):**

| Option | Pros | Cons |
|---|---|---|
| A) `pdf-lib` in the hub Worker: load, draw one line of Helvetica on each page, save | pure JavaScript, no native code, documented to run in any JS runtime (B); about 20 lines of our code | a new dependency, so the two-round repo safety scan comes first; large PDFs cost CPU (checked against the Worker CPU limit on the biggest pack in S6) |
| B) Hand-written PDF incremental update (append one content stream per page) | no dependency | fragile with compressed object streams; our own PDF writer to maintain |
| C) Pre-stamp at pack build time per teacher | no runtime work | needs a build per teacher; does not scale past the pilot |

**Preference: A**, because it is the smallest thing that works on Workers and keeps our own code to a few lines; B is the fallback only if the safety scan fails, with packs exported without object streams. The name printed is her Google display name (email if none); the privacy section of the legal page must say so (S0c).

### Request button

"Tell us what you need" on the teacher's account page and the packs page. Yearly or grant: a short form (`REQUEST_MAX_CHARS` 1000) posts to `POST /me/requests`; the insert enforces yearly access and `REQUESTS_PER_MONTH` in one statement; the hub opens an `avery-request` issue in the private ops repo with the request id and an admin link only. JJ reads the text at `/admin/requests`, fills it by hand, and sets the status (`in_progress`, `sent`, `declined`), which the teacher sees on her account page. Monthly and signed-in non-paying teachers see the button with "Included with the yearly plan". No AI generation in this plan.

### Pilot rules (60 days)

In `avery-hub/config/materials-pilot.json`, reported by the same agent-callable report script:

| Rule | Threshold | Config key | Data source |
|---|---|---|---|
| Pilot length | 60 days from S5 go-live | `pilot_days` (60) | clock |
| Keep going if | at least 3 signed-in teachers subscribe within 14 days of seeing the request offer AND at least 10 requests from members | `min_subscribes_after_offer` (3), `offer_window_days` (14), `min_member_requests` (10) | PostHog `request_offer_shown` then hub `subscription_changed`, per `analytics_id`; hub `requests` |
| Stop early | after 20 hand-made packs | `max_hand_made_packs` (20) | `requests` with status `sent` |

Anonymous visitors cannot be followed across days by design, so the 14-day rule counts signed-in teachers who saw the offer (C).

## Rankings (unchanged from version 2)

| Item | Rule |
|---|---|
| 1-hour class board (S3) | the nickname the child types plus a **room-only participant id**, random, kept in session storage under that room's code, cleared when the room ends, expires or the teacher resets it. No local storage, nothing that links her across rooms or days. Paid rooms only (an anonymous room has one round, so no cumulative board). |
| Where it lives | only in the game's Room DO; nothing about kids goes to D1 or the hub |
| What the class sees | cumulative points across rounds in that room; participant ids never sent to tablets |
| How long | `RANKING_KEEP_MINUTES` (60) of inactivity; the room follows `ROOM_TTL_MS`, moved to config |
| Never stored | real names on purpose, email, photo, voice, IP, location, device details |
| Law | the FTC treats a persistent identifier as personal information unless used only for internal operations (A, FTC COPPA FAQ sections A and J, read 2026-09-28) |
| **Long-term class ranking: BLOCKED** | needs a privacy lawyer's school and parent notice, consent path (FAQ section N), retention limit, reset, deletion on request and a no-commercial-reuse rule |

## Analytics (teacher screens only)

Settings, environments and tests unchanged from version 2: PostHog with joydong.org's settings (memory persistence, `$ip` null, geoip off, query strings and fragments stripped, no flags, no recording, no autocapture); `analytics_id` only; teacher screens only, shut down on any kid route; money events sent by the hub after Stripe confirms; privacy wording on the legal page changes in the same release as any analytics change. Anonymous teacher screens load analytics without an id (memory persistence, per page load).

| Event | When | Extra detail |
|---|---|---|
| `teacher_signed_in` | Google sign-in finished (server) | first time or returning |
| `free_round_used` | the game grants the one anonymous round | game |
| `paywall_shown` | "Sign in and subscribe to keep playing" appears | game, anonymous or signed in |
| `subscribe_card_shown` | a signed-in teacher sees the plans | where |
| `checkout_started` | she taps a plan | plan |
| `subscription_changed` | hub, after Stripe confirms | started, renewed, cancel scheduled, ended, refunded; plan |
| `round_started` | paid round from her screen | game, mode, room or single screen, player-count band |
| `list_saved` | she saves a list (server) | word-count band, never the words |
| `request_offer_shown` | the request button is shown | plan |
| `request_sent` | a request is stored (server) | none (never the text) |
| `pack_downloaded` | a download is served (server) | pack id |

Retired with the free tier: `free_list_replaced`, `free_mode_switched`, `switch_blocked_cooldown`, `taste_round_played`, `upgrade_card_shown`.

AEO for the games page stays a separate, later plan.

## Teacher data lifecycle

| Item | Rule | Config |
|---|---|---|
| Email change | refreshed from Google on every sign-in; identity stays `sub` | none |
| Two Google accounts | two teachers; merge only by JJ with `moveTeacher` after checking the receipt | none |
| Lost school account | new Google account, email to `hello@averystudio.org`; JJ checks the receipt, runs `moveTeacher`, every old session revoked, `admin_log` records it | none |
| Export | "Download my data": lists, classes, history, subscription summary, seat grants, requests (Codex S1 item 8) | none |
| Delete my account | confirmed twice (typed DELETE): cancels any subscription at once (no refund outside the window), revokes every session, deletes lists, classes, history, game sessions, requests and download log, tombstones the teacher row, drops the analytics mapping | none |
| After paid access ends | all her lists and classes are **hidden** (there is no free plan to keep one) for 90 days, then deleted; subscribing again within 90 days brings them back | `KEEP_AFTER_END_DAYS` (90) |
| Signed-in teacher who never pays or stops | full delete after 400 days without sign-in; never while any subscription is not `canceled` or `incomplete_expired`, nor with an unexpired seat grant | `INACTIVE_DELETE_DAYS` (400, C) |
| Expired rows | a daily cron removes expired sessions, game sessions and room passes (S1 open item 8) | none |

## School invoice and purchase-order route (unchanged)

"Need a school invoice or purchase order?" on the subscribe card and the account page opens an email to `hello@averystudio.org`. Runbook `avery-hub/docs/ops/school-po.md`: W-9, tax-exempt certificate, a Stripe invoice at net-30, then `grantSeats(emails, until, school)`. Seats count as yearly (packs and requests included). Renewal reminder issue 30 days before `access_until`.

## House rule and legal page

- **House rule reword:** little-games PR #24 (SHIP after two clean rounds) **merges before the hub merges**. Not restated here.
- **Legal page:** `https://www.averystudio.org/legal/policies`, draft joydong.org PR #88, anchors `#terms #privacy #children #refunds`. The hub, every game footer, Checkout and Google's consent screen link to those anchors. The plan does not restate the page. Two owner placeholders remain (mailing address, governing-law state).
- **S0c legal refresh (new slice):** the draft still describes version 2 (A, `policies.html`): a free plan with one saved list and a free game (lines 149-153), a 5-day switch and a daily taste round (153-154), $39 and $6.99 (159), "Your account stays, on the free plan" after a refund (300), and "lists beyond your 1 free list" (241). S0c changes those to: one free round per game per device, then subscribe; $29 and $4.99; after a refund or end, lists and classes hidden 90 days; plus two new lines: packs are licensed to one teacher for one classroom and carry her name in the footer, and request text is kept until she deletes her account. JJ approves the wording; the page goes live before S5.

## Environments and release operations

| Item | Staging | Production |
|---|---|---|
| Hub Worker | `avery-hub-staging` (live, A) | `avery-hub` on `hub.averystudio.org` |
| D1 | `avery_hub_staging` (b287b7d8..., A) | `avery_hub` (not created; `REPLACE_WITH_PRODUCTION_D1_ID` makes a production deploy fail safe, A) |
| R2 | `avery-packs-staging` | `avery-packs` |
| Google | staging client (Testing) | production client (published) |
| Stripe | test mode | test mode until S5, live from S5 |
| Rate-limit namespaces | own ids | own ids (differ from staging) |
| Games | staging Workers | six `*.averystudio.org` Workers |
| PostHog | off or staging project | production project |
| Alerts | private ops repo, `avery-alert-staging` | private ops repo, `avery-alert` |

| Operation | Rule |
|---|---|
| Migrations | numbered, additive only, applied before the code that needs them; the deprecated free-tier columns are dropped only after one full release with no reader |
| App rollback | `wrangler rollback` (B); additive migrations keep the previous version working |
| Backup and restore | D1 Time Travel restore rehearsed once on staging (not yet done, A, S1 open item 7) plus a weekly `wrangler d1 export` in private storage, never in git; R2 packs have their source in the pack build, so they can be rebuilt |
| Key rotation | overlapping hash keys; webhook secret rolled with both accepted; Google secret rotated in the console; steps in `docs/ops/rotation.md` (built, A) |
| Manual unlock and revoke | admin `grantAccess` and `revokeAccess` (built, A), both bump `entitlement_version` |
| Refund and dispute runbooks | `docs/ops/refund.md`, `dispute.md` (built, A) |
| Support | `hello@averystudio.org`, forwarding to the owner's inbox; shown in footers, the legal page, Checkout and the consent screen |
| Live provisioning | `stripe-setup.ts --env production --live --i-have-read-the-tax-gate` with the live key, then the readback |

## Remaining slices

Effort counts one working day of one build session; estimates are judgement (C). Review tier: **full panel** = three Claude lenses plus Codex, no round cap (anything touching money, auth or production writes); **default panel** = one Claude reviewer plus Codex.

| Slice | Work | Build | Review (tier) | Total | Parallel with | Depends on | Files it owns |
|---|---|---|---|---|---|---|---|
| **S1-fix** Hub fixes + v3 retire | bug-lens F1-F10 (F1 referrer policy, F2 passes kept and "revoked", F3 deferred FKs, F4 rotation race, F5 device-limit statement, F8 typed error, F10 localhost to `dev`); coverage lens's 6 missing tests; Codex 1-9 (item 10, the cooldown, is moot); decision 14 (one game session per game per hub session); retire `useTaste` and `switchFreeMode` from `GAME_REGISTRY`; stop reading and remove the deprecated `FREE_*` vars; new `entitlement` shape; `0002_v3.sql` (game-session unique index, `subscriptions.plan_interval`, `cancel_requested_by_teacher`, `requests`, `pack_downloads`); expired-row cron; Time Travel rehearsal | 1.5 | 1 (full) | 2.5 | S2a-fix, S0c | nothing | `avery-hub/src/{db,rpc,auth,admin,routes,pages}`, `migrations/0002_v3.sql`, `wrangler.jsonc`, `tests/` (non-Stripe) |
| **S2a-fix** Stripe model fixes + v3 | the 21-item panel fix round in progress; v2 prices and lookup keys from config; v1 archive (test mode only); `accessFor` v3 rows (teacher-asked grace, renewal slack, `plan`); refund doc wording | 1 | 0.5 (full) | 1.5 | S1-fix, S0c | JJ test key for a real test-mode run (can finish on fakes first) | `avery-hub/src/stripe/`, `scripts/stripe-setup.ts`, `docs/ops/{refund,dispute,stripe-webhook-inventory}.md`, `tests/stripe/` |
| **S0c** Legal refresh | the page changes listed under "House rule and legal page"; JJ approves; published before S5 | 0.5 | 0.5 (default, 2 rounds max for text) | 1 | anything | nothing | joydong.org `legal/policies.html` |
| **S2b** Hub billing and gate | `/billing/checkout` (customer reuse, idempotency, branding, auto-renew text), return check, BillingDO webhooks and queue, reconciliation, private ops repo and alert channel, refund-then-cancel admin tool, `authorizeRound` with round grants and server-built questions support, `mintRoomPass` conditional insert, `checkRoomPass`, seat grants as `grant`, hub-down tests, full test-mode run on staging | 4 | 1.5 (full) | 5.5 | S0c | S1-fix, S2a-fix | `avery-hub/src/billing/`, `src/do/billing-do.ts`, `src/rpc/` gate methods, `src/routes/billing.ts` |
| **S2c** Gate in the vocab app | the six integration steps; `/api/round/start` with server-built questions for single-screen modes; room pass and anonymous pass on both `POST /api/rooms` paths; `/round` and `/start` check the pass; `ROOM_TTL_MS` to config; taste cookie; subscribe card; kid-screen tests; custom domain branch merged | 2.5 | 1 (full) | 3.5 | S2d, S6, S4 (hub side) | S2b | vocab repo `src/worker/{index,room-do,persist,policy}.ts`, `wrangler.jsonc`, `src/client/{router,state}.ts`, `src/client/screens/{set,account,upgrade}.ts` |
| **S2d** Gate in five little-games Workers | first a shared `avery-gate/` module in this repo (worker helper: taste cookie, hand-off routes, `round/start`, room and anonymous pass; client: sign-in button, subscribe card), then five parallel builders, one per game, each wiring the steps and its routes from the table | 1 (shared) + 5 x 1 | 1.5 (full, one panel over all five) | 7.5 work, about 3.5 elapsed | S2c, S6 | S2b | `avery-gate/` (shared builder only); each builder owns only `<game>/src/worker/{index,room-do,env}.ts`, `<game>/src/client/*`, `<game>/wrangler.jsonc`, `<game>/tests/` of its own game |
| **S6** Materials | R2 buckets, `packs.json` and validation, `/downloads` list and stamped download (after the safety scan of the chosen PDF library), `pack_downloads` cap, request form, `requests` flow, `/admin/requests`, issue to the private repo, pilot report rules | 2.5 | 1 (full) | 3.5 | S2c, S2d | S2b; owner licence check before any pack is marked `licenceChecked` | `avery-hub/src/{downloads,requests}/`, `config/{packs,materials-pilot}.json`, `src/admin/requests.ts` |
| **S3** Rankings | room-only participant id, cumulative 1-hour board in paid rooms, config for keep minutes and room TTL, clear-on-end tests | 1.5 | 0.5 (default) | 2 | S4 | S2c (same vocab room files) | vocab room join and ranking screens, `ranking.ts`, `room-do.ts` ranking slot |
| **S4** Analytics | teacher-only loader with route-change shutdown, the 11 events, the four analytics tests, pricing and pilot report script | 1.5 | 0.5 (default) | 2 | S3 | S2c, S2d (event calls in their screens), S6 (request and download events) | new vocab `analytics.ts`, `avery-gate/analytics.ts`, `avery-hub/src/analytics/`, `scripts/pricing-test-report.ts` |
| **S5** Live | production D1, R2 and rate-limit namespaces; published consent screen; live key, live provisioning and readback; live portal and webhook; tax gate passed; first real purchase, cancel and refund on the live site; automatic receipt proven; real fee lines recorded; each gated game's demo re-recorded on the live site (the one free round plus the paywall; paid screens with a `grantAccess` staff account) | 1.5 | 0.5 (full) | 2 | none | everything above, S0c live, For JJ items 1-3 | ops docs, demo outputs |

**Totals:** build 22.5 days, review and fix rounds 8.5 days: 31 days of work, **about 37 with 20% contingency**.

**Elapsed time:**

| Way of working | Path | Days |
|---|---|---|
| Parallel sessions | S1-fix (2.5, beside S2a-fix and S0c) then S2b (5.5) then S2c, S2d, S6 side by side (3.5) then S3 and S4 side by side (2) then S5 (2) = 15.5 | **about 19 working days** (15.5 x 1.2 = 18.6) |
| One session at a time | every slice in a row, 31 | **about 37 working days** (31 x 1.2) |
| Plus, outside our control | Google consent-screen publishing and brand review (days, B), Stripe keys, the tax check, the owner licence check, JJ approving the legal wording | added on top |

```
S1-fix ----+
S2a-fix ---+--> S2b --+--> S2c --+--> S3 --+
S0c (any time, live before S5)   |         |
                      +--> S2d --+--> S4 --+--> S5
                      +--> S6 ---+         |
(owner licence check) --> S6 packs visible |
(JJ: Google, Stripe, tax) -----------------+
```

## Six-month operations checklist (S5 exit criteria)

| Item | Check | How often |
|---|---|---|
| Portal configuration | test and live portals allow the same three actions | at launch and after any change |
| Cancel timing | cancel at period end tested with and without grace; monthly-to-yearly runbook tested | at launch |
| Failed-payment recovery | Stripe retries and reminder emails on; our grace matches | monthly |
| Webhook failures | alert fires when deliveries fail or the endpoint is disabled | always on |
| Reconciliation | ran, and alerts on drift or a missed run | daily |
| Google sign-in | secret rotation; callback list current; a real school account still signs in | each school term |
| Disputes | runbook owner, evidence location, Stripe's deadline | per dispute |
| Refund balance | enough available balance, or refunds sit pending | monthly |
| Key rotation | hash keys, webhook secret, Google secret, game keys | every 6 months or on a leak |
| Data deletion | retention and expired-row crons ran; delete-on-request tested | monthly |
| Per-teacher separation | isolation tests pass | every deploy |
| Backups | weekly export present; restore rehearsed | weekly, rehearsal each term |
| Packs | every listed pack has `licenceChecked: true`; one stamped download opened and looked at | each new pack |
| Materials pilot | report run; stop rule checked | weekly during the pilot |

## Risks

| Risk | Grade | What we do |
|---|---|---|
| A hard paywall after one round loses teachers who would have stayed on a free plan | C | the pricing test and `paywall_shown` to `checkout_started` show it; `ANON_FREE_ROUNDS_PER_GAME` and `TRIAL_DAYS` change it without code |
| Clearing cookies gives another free round | B | accepted by decision 9; nothing that matters (lists, classes, packs, a second round in a room) is reachable that way |
| A district blocks outside apps on teacher Google accounts | B | test with a real school account in S2c; email magic link is the fallback, about 1 more day |
| Consent screen stays in Testing (100-user cap) | B | For JJ item 1 now; S0c publishes the legal page early |
| Alert or request issues leak teacher data | A (repo is public) | private ops repo; ids only in issue bodies |
| Packs shared after a monthly or cancelled plan | C | yearly only, her name in the footer, daily cap, licence line |
| A font or illustration in a pack is not licensed for redistribution | C | owner licence check; unchecked packs stay hidden |
| PDF stamping exceeds the Worker CPU limit on a large pack | C | measured in S6 on the biggest pack; cache the stamped copy in R2 per teacher if needed |
| Receipts show Ownly Network LLC, not Avery | A | stated on the subscribe card |
| Someone rewrites our JavaScript to play a browser-run mode offline | B | accepted; no rooms past one round, no lists, classes, history or packs |
| Hub outage | C | failure matrix; the one free round never needs the hub |
| Refund later re-granted by reconciliation | B | `accessFor` reads charges and disputes; never clears `refunded_full` |
| Tax on printable packs differs from a software subscription | C | For JJ item 3 names it explicitly |
| `admin@ownly.network` domain lapses and the Stripe account's public support email dies | A (version 2) | change the Stripe public support email to `hello@averystudio.org` before S5 |

## QA bar (before anything reaches JJ)

1. Static checks: `tsc --noEmit` on the hub, the vocab app and each gated game.
2. Tests green: `accessFor` rows, token protocol (including one game session per game), gate rules per game, concurrency, isolation, webhook, hub-down, analytics, downloads and requests.
3. Live surface on staging: real Google sign-in (two accounts in one browser); in each of the six games, the one anonymous round then the paywall; an anonymous room's second round shows the message on the teacher screen and "Round over" on a second tablet; test-card purchase of each plan; paid rounds in every game; paid room from a second tablet; cancel in the portal and the grace; refund then cancel ends access at once; a pack download opened and its footer read; a request lands as an issue in the private repo with no text in it; sign out everywhere reaches every game. State what was checked live and what is still assumed.
4. Visual check: open and look at the paywall, subscribe card, "Signed in as", account page, packs page, stamped PDF footer, device picker and ranking on a phone and a tablet.
5. Re-record each gated game's demo on the live site after S5, per the repo's demo rule.
6. Reviews per slice as listed; Codex reviews before anything is handed to JJ.

## Open questions (each default stands unless JJ changes it)

| Question | Default |
|---|---|
| Tax: home state, taxability (now with packs), other states | JJ and her accountant, before S5 (For JJ item 3) |
| Legal page placeholders: mailing address, governing-law state | owner fills before S0c publishes |
| Font and art licence check for the packs | owner, one day, before S6 marks any pack visible |
| A `trialing` subscription set by hand in the Dashboard: honour it to `trial_end`, or treat as none? (S2a report open question 1) | honour it (a trial only exists if someone set it on purpose) |
| Past-due grace counted from the period start or from the first failed invoice (S2a report open question 2) | period start |
| Where dispute evidence is stored (holds teacher data; not this repo) | a private folder JJ picks, named in `dispute.md` |
| Game `signOut` ends the whole device's hub session (all games), not just this game (bug-lens N3) | yes, whole device, as built |
| Seat and manual grants count as yearly for packs and requests | yes (`GRANT_COUNTS_AS`) |

## Follow-ups (not in this plan)

- Paid agent path (a teacher-issued API key through the hub), per the agent-native rule; after the paywall an agent can host only one round per game without it.
- Long-term class ranking, after the consent path.
- AI-made packs (the made-to-order hypothesis), only if the materials pilot passes its bar.
- Dropping the deprecated free-tier columns (a migration one release after S1-fix).
- AEO plan for the games page.

## Sources read for this version

- Version 2 of this plan (commit on `feat/avery-accounts-pay-plan` before this change) and its review trace
- `/Users/joyd/lg-scans/build-s1-hub.md`, `/Users/joyd/lg-scans/build-s2a-stripe.md`
- `/Users/joyd/lg-scans/review-s1-claude-bugs.md`, `review-s1-claude-coverage.md` (G12 and N3: old game session still valid after a new hand-off), `review-s1-claude-evidence.md`, `review-s1-codex.md`
- `/Users/joyd/lg-scans/research-materials-subscription-summary.md`, `/Users/joyd/lg-scans/custom-domains-report.md`
- `/Users/joyd/jd-legal/legal/policies.html` (branch `feat/avery-legal-teacher-accounts`)
- `/Users/joyd/lg-hub/avery-hub/` (`wrangler.jsonc` `GAME_REGISTRY` and vars, `migrations/0001_init.sql`, `docs/HUB-API.md`, `src/rpc/hub-service.ts`) at `441b022`
- `/Users/joyd/lg-hub/{tianzige-generator,trace-race,stroke-reveal,missing-stroke,dictation-dash}/` (`wrangler.jsonc`, `src/worker/index.ts`, `src/client/main.ts`, `src/client/solo.ts`, `src/client/api.ts`)
- `/Users/joyd/Bilingual Vocab Game Generator/` `main` at `77e490f` (`wrangler.jsonc`, `src/worker/index.ts`, `src/worker/room-do.ts`)
- `gh repo view joydai2026-del/little-games` (visibility PUBLIC), 2026-09-29
- Version 2's web sources (Cloudflare RPC and D1, Stripe Checkout, products, statement descriptors, refunds, tax, Google OpenID Connect, FTC COPPA FAQ, Public Suffix List), read 2026-09-28
