---
date: 2026-09-28
topic: Avery accounts and pay (Google sign-in, D1, Stripe under Ownly Network LLC)
status: plan round 2 (after the round-1 Claude and Codex plan reviews, both FIX-FIRST)
branch: feat/avery-accounts-pay-plan
decision board: vault projects/little-games/2026-09-28-pricing-and-stripe-options.html (round 2)
reviews answered: /Users/joyd/lg-scans/review-pr18-plan-claude.md, /Users/joyd/lg-scans/review-pr18-plan-codex.md
---

# Avery accounts and pay: build plan

## In one minute

- **Free, no sign-in:** a teacher pastes a list and plays the free mode, rooms included. Nothing is saved and there are no class codes. This keeps working even if the new service is down.
- **Sign in with Google** to save a list, use class codes, or subscribe. Her lists, classes, history and subscription follow her to any device. Two teachers' data never mix.
- **Paid:** $39 a year or $6.99 a month, run as a pricing test with written keep-or-change rules. Money goes through the existing **Ownly Network LLC** Stripe account; bank statements say **AVERY STUDIO**.
- **Kids** never sign in, never see a paywall, and never load analytics. They type only a nickname to join a room, as today.
- **One new service, avery-hub**, owns sign-in, the teacher database, Stripe and the answer to "may this teacher do this?". Games stay their own Workers and ask the hub.
- **Schedule (with 20% contingency):** about 27 days of work including reviews and fix rounds. About 21 working days from start to live if slices run in parallel sessions, about 27 with one session at a time, plus JJ-side waits (legal page wording, Google consent-screen publishing, tax registrations).

## For JJ first

| # | Item | What you can do |
|---|---|---|
| 1 | **Teachers can paste and play the free mode without signing in** (rooms included; nothing saved, no class codes). Sign-in is needed only to save a list, use class codes, or subscribe. Decided by the commander under JJ's standing rule "no feedback = go with your recommendation" (2026-09-28); JJ can overturn. | Say "require sign-in for free play" to overturn; the gate then treats anonymous visitors as having no free mode. |
| 2 | **The long-term class ranking is blocked** until a school and parent consent path exists; the 1-hour board uses a room-only id instead of a device id (section "Rankings"). | Nothing now; the unblock list is written out. |

Claim grades: **A** = read today in the named source, **B** = standard platform behaviour not re-read today, **C** = estimate or judgement.

## Decisions this plan builds on

| # | Decision | Who, when | Where it lands |
|---|---|---|---|
| 1 | Teachers sign in with Google (school or personal Gmail), stay signed in, and get a profile: lists, classes, history, subscription. Different teachers' data must never overlap. Kids never sign in and never see a paywall. | JJ, 2026-09-28 | S1 |
| 2 | One Stripe account, Ownly Network LLC. Avery Studio is part of it. Seller for tax is Ownly Network LLC. | JJ, 2026-09-28 | S2a, S5 |
| 3 | $39 a year + $6.99 a month as a pricing test with the thresholds below. Free = 1 list + 1 mode. | JJ, 2026-09-28 | S2b, pricing test |
| 4 | Free mode may switch, with a nudge toward subscribing (14-day cooldown + one taste round a day). | JJ, 2026-09-28 | S2b |
| 5 | Teacher-side product analytics matter. Teacher screens only, never kid screens, no child data. AEO is a separate later track. | JJ, 2026-09-28 | S4a, S4b |
| 6 | Student rankings students can see. | JJ, 2026-09-28 | S3 (see the COPPA change below) |
| 7 | **Teachers can paste and play the free mode without signing in** (nothing saved, no class codes). Sign-in is required only to save a list, use class codes, or subscribe. | Decided by the commander under JJ's standing rule "no feedback = go with your recommendation" (2026-09-28); JJ can overturn (see "For JJ first") | S2b |
| 8 | **The paid gate moves ahead of the brief's order.** The pickup brief lists the soft $39/yr gate at build priority 5 (A, `docs/avery/AVERY-CLASSROOM-GAMES-PICKUP.md` line 50). JJ moved it up on 2026-09-28 by asking for this plan. | JJ, 2026-09-28 | whole plan |

**One change to decision 6, for the law, surfaced here rather than done quietly.** JJ asked for a nickname plus a device id, remembered for 1 hour or long term. A device id that lives in the browser's storage links a child across rooms and days, which the FTC treats as personal information unless it is used only to run the service (A, FTC COPPA FAQ). So: the 1-hour board uses a **room-only participant id** (made when the child joins, gone with the room). The **long-term class ranking is BLOCKED**, not just off by default, until a school and parent notice and consent path exists (section "Rankings"). JJ's long-term wish stays in scope and is listed as blocked; it is not dropped.

## Pricing test (the rules, written in)

These are the board's proposals that JJ accepted on 2026-09-28. They live in `avery-hub/config/pricing-test.json`, not in code, and a report script (`avery-hub/scripts/pricing-test-report.ts`, agent-callable, built in S5) prints each rule as met or not met.

| Rule | Threshold | Config key | Data source |
|---|---|---|---|
| When to judge | 60 days after live launch or 30 paying teachers, whichever comes later | `judge_after_days` (60), `judge_after_paying_teachers` (30) | Stripe |
| Keep both plans if | monthly is at least 20% of new paying teachers AND at least half of monthly teachers are still paying after 3 months | `keep_monthly_min_share` (0.20), `keep_monthly_min_retention_3mo` (0.50) | Stripe |
| Drop monthly if | monthly is under 20% of new paying teachers, OR most monthly teachers cancel within 2 months | `drop_monthly_max_share` (0.20), `drop_monthly_cancel_2mo` (0.50) | Stripe |
| Revisit the $39 price if | fewer than 2 in 100 teachers who see the upgrade card start a checkout | `revisit_price_min_checkout_rate` (0.02) | PostHog `upgrade_card_shown` then `checkout_started`, per teacher |
| Free list rule | a free teacher may replace her one saved list at any time | `FREE_LIST_LIMIT` (1) | hub |
| Free mode rule | 14-day switch cooldown, one taste round a day | `FREE_MODE_SWITCH_COOLDOWN_DAYS` (14), `FREE_TASTE_ROUNDS_PER_DAY` (1) | hub |

## Architecture

### The pieces

| Piece | Where | What it does | Talks to |
|---|---|---|---|
| **avery-hub** (new Worker) | this repo, `avery-hub/` | Google sign-in, hub sessions, all game sessions, D1 database, Stripe, webhooks, reconciliation, the free and paid gate, admin tools | Google, Stripe, D1, its Durable Objects, PostHog (server events), alert channel |
| **HubService** (named RPC entrypoint of avery-hub) | `avery-hub/src/rpc/hub-service.ts` | the only way a game reaches teacher data or the gate | called by game Workers through a service binding |
| **TokenDO** (Durable Object) | avery-hub | one object per hand-off token; redeems it exactly once | HubService |
| **BillingDO** (Durable Object) | avery-hub | one object per Stripe customer; processes that customer's Stripe events one at a time | webhook route, reconciliation cron |
| **D1 database** | bound to avery-hub only | teachers, sessions, game sessions, lists, classes, history, subscriptions, Stripe events, seat grants, audit log | avery-hub only |
| **Vocab Generator** (existing Worker) | repo `joydai2026-del/bilingual-vocab-game` | the game. Anonymous free play stays local to it; everything signed-in or paid goes through HubService | HubService (service binding), kid devices |
| **Trace Race, Tianzige, later games** | this repo | same pattern once they get paid features | HubService |
| **Room Durable Object** (existing, in each game) | game Worker | holds the room, its room pass, and the room's 1-hour ranking | kid devices, its game Worker |
| **Legal pages** | `averystudio.org` (served from the `joydai2026-del/joydong.org` repo, A) | privacy policy, terms, refund policy, support contact | linked from the hub, games, Checkout and Google's consent screen |

### The internal API is RPC only (never public)

- avery-hub's default `fetch` handler serves only public routes: `/auth/*`, `/me`, `/billing/*`, `/stripe/webhook`, `/admin/*` (behind Cloudflare Access). It has **no** `/internal/*` route at all.
- Everything a game needs is a typed method on a **named** `WorkerEntrypoint` class, `HubService`. A game reaches it only through a service binding that names that entrypoint (`"entrypoint": "HubService"` in the game's `wrangler.jsonc`), the pattern Cloudflare documents for named entrypoints (A, https://developers.cloudflare.com/workers/runtime-apis/rpc/). A named entrypoint does not receive internet traffic; only the default export does (B).
- Each game gets its own binding with a `GAME_ID` and a per-game key: every HubService method takes `{ gameId, gameKey }` as its first argument. The hub checks the pair against `GAME_REGISTRY` (config: game id, allowed return URLs, hashed game key, allowed methods). So one game cannot act as another, and a game can only call the methods listed for it.
- **Audience check:** every game session and every room pass records the game id it was minted for. A method called by game X with a session or pass minted for game Y is refused.
- **Tests:** (1) a public HTTP request to `/internal/anything`, `/rpc`, `/HubService` and every method name returns 404; (2) a call with game X's key and game Y's session returns "refused"; (3) a call to a method not listed for that game returns "refused".

HubService methods (first version):

| Method | Purpose | Needs |
|---|---|---|
| `redeemHandoff(game, token, bindingValue)` | swap a one-time hand-off token for a game session | token bound to this game and this browser |
| `resolveSession(game, gameSessionId)` | who is this, and is the session still valid | game session of this game |
| `entitlement(game, gameSessionId)` | plan, free mode, cooldown date, taste rounds left, list limit (for showing the UI only) | game session |
| `authorizeRound(game, gameSessionId or null, mode, roomCode or null)` | server decision for one round start; returns a round grant | see "Free and paid gate" |
| `useTaste(game, gameSessionId, mode)` | spend today's taste round, atomically | game session |
| `switchFreeMode(game, gameSessionId, mode)` | change her free mode, atomically, respecting the cooldown | game session |
| `listLists / getList / saveList / deleteList` | her saved lists | game session |
| `listClasses / saveClass / deleteClass` | her classes and class codes (paid) | game session, paid |
| `mintRoomPass(game, gameSessionId, roomCode)` | room pass for a signed-in teacher's room | game session |
| `checkRoomPass(game, passId)` | is this pass still good (called at each round start) | pass of this game |
| `signOut(game, gameSessionId)` | end this device's hub and game sessions | game session |

### One token protocol

| Piece | Rule |
|---|---|
| Pre-set binding cookie | Before sending the teacher to the hub, the game sets `__Host-avery_bind` = 32 random bytes (Secure, HttpOnly, SameSite=Lax, 10 minutes) and passes only its SHA-256 hash to `hub/auth/start?game=<id>&bind=<hash>`. This is the login-CSRF defence: a token made for the attacker's browser cannot be redeemed in the teacher's browser. |
| Hand-off token | 32 random bytes, opaque (not signed, not a JWT). Sent to the game in the URL fragment (`game/auth/finish#t=...`), so it never reaches server logs or referrers. The page posts it to its own Worker and clears the address bar. |
| At rest | Stored only as `HMAC-SHA256(SESSION_HASH_KEY_v<N>, token)` with the key version `N`, in a **TokenDO** named by that hash. Fields: hub session id, teacher id, game id (audience), bind hash, created at, expires at, key version, used flag. |
| Redemption | `redeemHandoff` goes to the TokenDO, which checks game id, bind value (hashed, compared in constant time), expiry (`HANDOFF_TOKEN_SECONDS` 60) and the used flag, then sets used, all inside the Durable Object's own storage, so two redemptions cannot both succeed (B: a Durable Object runs one request's storage operations without interleaving). An alarm deletes the object after expiry. |
| Game sessions | **Minted and stored by the hub**, never by the game. `game_sessions` row: id hash, key version, hub session id hash, teacher id, game id, created at, last used at, absolute expiry. The game's cookie (`__Host-avery_game`, Secure, HttpOnly, SameSite=Lax) holds only the random id. Every HubService call passes it and the hub resolves the teacher. |
| Revocation | Ending a hub session ends every game session made from it. "Sign out everywhere", the device limit, JJ's revoke and account deletion all act in the hub, so they reach every game at once. Test: sign out everywhere, then the old game cookie is refused by every method. |
| Lifetimes | Hub session: idle `SESSION_IDLE_DAYS` (30), absolute `SESSION_MAX_DAYS` (90), id rotated on sign-in and every `SESSION_ROTATE_DAYS` (7) of use. Game session: absolute `GAME_SESSION_HOURS` (12), idle `GAME_SESSION_IDLE_HOURS` (4), id rotated on each hand-off. |
| CSRF on actions | Every state-changing route (hub and game) is POST only, checks the `Origin` header against the allowlist, and requires SameSite=Lax cookies; hub forms also carry a per-session CSRF token. |
| Rate limits | `/auth/start` and `redeemHandoff` are rate-limited with Cloudflare's rate-limiting binding (B); keys are the binding hash and game id, not stored IP addresses. `AUTH_START_PER_MINUTE` (20), `REDEEM_PER_MINUTE` (20). |
| Key rotation | Overlapping keys: `SESSION_HASH_KEY_V1`, `SESSION_HASH_KEY_V2`, with `SESSION_HASH_KEY_CURRENT` in config. New values use the current key; lookups try the recorded version. Rotation never logs everyone out. |

### Sign-in and hand-off flow

| Step | Who | What happens |
|---|---|---|
| 1 | Teacher on a game | Taps "Sign in with Google". Game sets the binding cookie and sends her to `hub/auth/start?game=<id>&bind=<hash>`. The game id must be in `GAME_REGISTRY`. |
| 2 | Hub | Valid hub session? Skip to step 5. Otherwise start Google's server flow: random `state` stored server-side, random `nonce`, scopes `openid email profile`, `prompt=select_account` so a teacher with two Google accounts always picks (A for the flow, https://developers.google.com/identity/openid-connect/openid-connect; B for `select_account` behaviour). |
| 3 | Google | She picks her account; Google returns `code` and our `state`. |
| 4 | Hub | Checks `state`; swaps the code server-side; checks the ID token's signature, issuer, audience and nonce; requires `email_verified` true. Finds or creates the teacher by Google's `sub` (never changes), not by email (can change) (A, same page). Updates stored email and display name on every sign-in. Applies the device limit (below). Sets the hub session cookie. |
| 5 | Hub | Makes the hand-off token for this game and binding, redirects to the game's registered return URL. |
| 6 | Game page | Posts the token and the binding cookie to its Worker; clears the fragment. |
| 7 | Game Worker | Calls `redeemHandoff`. Gets back a game session id and the teacher's display email. Sets its game cookie; clears the binding cookie. |
| 8 | Game screens | Show "Signed in as x@school.org" on the teacher screen, on the upgrade card and before checkout, so a teacher with two Google accounts does not pay twice. |

**Device limit.** A "device" is one browser signed in to the hub (one hub session); its game sessions do not count separately. Default `MAX_TEACHER_DEVICES` 3. At the limit, signing in on a new device shows her signed-in devices (browser name and last used date) and asks which to sign out. Nothing is signed out silently mid-lesson.

**Sign-out.** "Sign out" ends this browser's hub session and its game sessions; it does not sign her out of Google, and the screen says so. "Sign out everywhere" ends every hub and game session for her.

### Google environments

| Item | Staging | Production |
|---|---|---|
| Hub address | `https://avery-hub-staging.joyd-ai-2026.workers.dev` | `https://hub.averystudio.org` (Workers custom domain, B) |
| Google Cloud project and OAuth client | separate staging project and client | separate production project and client |
| Exact callback URIs registered | `https://avery-hub-staging.joyd-ai-2026.workers.dev/auth/callback`, `http://localhost:8787/auth/callback` | `https://hub.averystudio.org/auth/callback` only |
| Consent screen status | Testing: only listed test users can sign in, capped at 100 (B) | Published (a JJ step): needs the home page, privacy policy and terms on `averystudio.org` and the domain verified; scopes are only `openid email profile`, so no security assessment, but brand review can take days (B) |
| Game return URLs allowed | staging game Workers | production game Workers |

Google rejects a callback that is not an exact registered match (B), so every address above is listed exactly and tested in S1.

**Why the hub moves to averystudio.org in production:** the consent screen needs a home page and privacy policy on a domain you control, and `workers.dev` is shared (B). Games can stay on `workers.dev` because each game gets its session by the hand-off, not by a shared cookie. `workers.dev` is on the Public Suffix List (A, https://publicsuffix.org/list/public_suffix_list.dat), so cookies cannot be shared across games there anyway.

### When the hub is down or broken

Rule: anything that saves, spends or unlocks **fails closed**. Anonymous free play never needs the hub. A room that was already authorized keeps going on its bounded room pass.

| Moment | What the teacher sees | What the system does |
|---|---|---|
| Sign-in | "Can't sign in right now. You can still play your free mode." | redirect fails; game stays anonymous |
| Hand-off redemption | same message | no game session is made |
| Saving a list | "Can't reach your lists right now. Your list is still here; try again in a minute." | draft stays in the browser's session storage; nothing is written |
| Starting a paid round, taste round, mode switch or class action (no room pass) | the free mode only | `authorizeRound` unreachable, so the round is refused unless it is the anonymous free mode |
| Room already open with a paid room pass | nothing changes | the Room DO allows modes on its pass until the pass expires (`ROOM_PASS_HOURS` 4); after that, only the free mode |
| Room pass re-check at round start | nothing changes | if the hub answers "revoked", the room drops to the free mode; if the hub does not answer, the stored pass decides until it expires |
| Checkout return | "We're confirming your payment; it can take a minute." | the one-time checkout code stays valid for `CHECKOUT_CODE_MINUTES` (60); reconciliation finishes it if needed |
| Stripe webhook | nothing | Stripe retries live events for up to 3 days (A, board source docs.stripe.com/webhooks); reconciliation also catches it |

Tests: for each row, the HubService binding is replaced with one that throws, and the expected result is asserted.

**Room pass fields:** pass id, game id (audience), room code, teacher id (or `anon`), allowed modes, entitlement version, issued at, expires at. It is stored in the Room DO in its own storage slot, like `hostKey` today (A, `src/worker/persist.ts`), never sent to any device. Verification: at every round start the Room DO checks expiry, room code, mode, and (when the hub answers) `checkRoomPass`. Revocation: a refund, dispute, cancel-now or account deletion bumps the teacher's entitlement version, and `checkRoomPass` then says revoked. Replay: a pass id is bound to one room code and one game, so copying it into another room does nothing.

## Data model and per-teacher isolation

### Tables (D1, created by numbered migration files)

| Table | Key and constraints | Main columns |
|---|---|---|
| `teachers` | `id` PK; `google_sub` UNIQUE NOT NULL; `stripe_customer_id` UNIQUE; `analytics_id` UNIQUE | `email`, `display_name`, `free_mode`, `free_mode_locked_until`, `taste_day`, `taste_used`, `entitlement_version`, `created_at`, `last_seen_at`, `deleted_at` |
| `sessions` (hub) | `id_hash` PK; FK `teacher_id` to `teachers(id)` ON DELETE CASCADE; **`UNIQUE(teacher_id, id_hash)`** so child tables can reference the pair | `key_version`, `browser_label`, `created_at`, `last_used_at`, `absolute_expiry`, `revoked_at` |
| `game_sessions` | `id_hash` PK; columns `teacher_id`, `hub_session_id_hash`; composite FK (`teacher_id`, `hub_session_id_hash`) REFERENCES `sessions(teacher_id, id_hash)` ON DELETE CASCADE. Chosen over keying on `hub_session_id_hash` alone because the database itself then refuses a game session whose teacher differs from its hub session's teacher. Migration test: inserting a game session with a mismatched teacher fails. | `game_id`, `key_version`, `created_at`, `last_used_at`, `absolute_expiry`, `revoked_at` |
| `lists` | PK (`teacher_id`, `id`); FK `teacher_id` | `title`, `level`, `items_json`, `hidden`, `created_at`, `updated_at` |
| `classes` | PK (`teacher_id`, `id`); UNIQUE `class_code`; composite FK (`teacher_id`, `list_id`) to `lists(teacher_id, id)` | `name`, `created_at` |
| `round_history` | PK (`teacher_id`, `id`); composite FKs to her `lists` and `classes` | `game_id`, `mode`, `started_at`, `player_count_band` |
| `subscriptions` | PK `stripe_subscription_id`; FK `teacher_id`; index on `teacher_id` | `price_id`, `status`, `current_period_end`, `cancel_at_period_end`, `latest_charge_id`, `refunded_full`, `dispute_state`, `access_until`, `synced_at` |
| `stripe_events` | PK `event_id` | `type`, `customer_id`, `object_id`, `status` (received, processed, failed), `attempts`, `last_error`, `received_at`, `processed_at` |
| `billing_ops` | PK `op_id`; FK `teacher_id` | `kind` (refund, cancel), `step`, `idempotency_key`, `status`, `attempts`, `last_error` |
| `checkout_codes` | PK `code_hash` | `teacher_id`, `checkout_session_id`, `expires_at`, `used_at` |
| `seat_grants` | PK (`email`, `school_ref`) | `access_until`, `granted_by`, `attached_teacher_id` (school purchase-order seats) |
| `admin_log` | PK `id` | `actor`, `action`, `target_teacher_id`, `reason`, `at` |

No kid data is stored in D1. Room rankings live only in each Room DO (section "Rankings"). A `class_rankings` table is reserved for the blocked long-term ranking and is not created in v1.

D1 enforces foreign keys, and a failed statement in a batch rolls back the whole batch: "Batched statements are SQL transactions" (A, https://developers.cloudflare.com/d1/worker-api/d1-database/). Separate D1 calls are **not** one transaction, so every read-then-write rule below is a single conditional statement or a batch.

### The isolation rule

1. All SQL lives in `avery-hub/src/db/`. No route, RPC method or Durable Object calls `env.DB` directly.
2. Teacher data is reached only through `forTeacher(db, teacherId)`. Every statement inside it binds `teacher_id = ?1`, including joins (both sides), counts and pagination.
3. `teacherId` comes only from a hub session resolved by the hub or a game session resolved by the hub. No body, query string, header or RPC argument can set it.
4. Admin actions live in `avery-hub/src/admin/`, reachable only from `/admin/*` behind Cloudflare Access with a service token (agent-callable with that token, B), every action written to `admin_log`. A test fails if any teacher route or HubService method imports from `src/admin/`.

### Atomic writes

| Rule | How (one statement or one batch) |
|---|---|
| Hand-off token burn | inside the TokenDO (above) |
| Checkout code burn | `UPDATE checkout_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at>?`, then require exactly 1 changed row |
| Taste round | `UPDATE teachers SET taste_day=?1, taste_used=CASE WHEN taste_day=?1 THEN taste_used+1 ELSE 1 END WHERE id=?2 AND (taste_day<>?1 OR taste_used<?3)`, require 1 changed row |
| Free mode switch | `UPDATE teachers SET free_mode=?, free_mode_locked_until=? WHERE id=? AND (free_mode_locked_until IS NULL OR free_mode_locked_until<=?)`, require 1 changed row |
| Free list limit | `INSERT INTO lists ... SELECT ... WHERE (SELECT COUNT(*) FROM lists WHERE teacher_id=? AND hidden=0) < ?limit`, where `?limit` is `FREE_LIST_LIMIT` for free teachers and unlimited for paid; require 1 changed row |
| Webhook claim and effect | serialized in BillingDO; state write and "processed" mark in one batch (section "Stripe") |

Tests fire 10 concurrent taste, switch, list-save and redeem requests and assert exactly the allowed number succeed.

### Isolation tests (every deploy; a failure blocks the deploy)

For every table above, every HubService method and every hub route that reads, joins, counts, pages, inserts, upserts, updates or deletes, a test runs as teacher A against teacher B's ids and asserts "not found" or "refused", then asserts B's rows are unchanged. Plus:

| Test | Proves |
|---|---|
| A body, query or RPC argument naming B's teacher id still acts on A | the id cannot be injected |
| A class of A's cannot point at B's list (composite FK) | constraints hold |
| Same browser: sign in as A, save; switch to B with `select_account`, B sees none of A's lists; back to A, A's lists are intact | two accounts on one computer do not mix |
| Login CSRF: a hand-off token made for another browser's binding is refused | the attacker cannot sign the teacher into the attacker's account |
| A token redeemed twice, after 60 seconds, or by another game: refused | no replay |
| Sign out everywhere, then old hub and game cookies: refused by every method | revocation reaches every game |
| A Stripe event for B's customer changes only B's subscription | money lands on the right teacher |
| Admin module not importable from teacher code; `env.DB` used only in `src/db/` | nobody bypasses the layer later |

## Free and paid gate (server-side)

### What counts as "saved"

A **saved list** is a list stored in the hub under her teacher id and shown in "My lists". A list carried in a game link (`#/play/<mode>/<enc>`, A, `src/client/router.ts` line 1) is an **unsaved, ad-hoc list**: anyone may play it, but only in the free mode, with no class code and no history. So bookmarking many links gives nothing that anonymous play does not already give, and cannot bypass "1 saved list".

### Who may do what

| Action | Anonymous | Signed-in free | Paid |
|---|---|---|---|
| Paste and play a list | yes, `ANON_FREE_MODE` only | yes, her `free_mode` | yes, every mode |
| Open a room (multi-tablet) | yes, `ANON_FREE_MODE` only | yes, her free mode | yes, every mode |
| Taste round of a locked mode | no | `FREE_TASTE_ROUNDS_PER_DAY` (1) | not needed |
| Switch free mode | no | once per `FREE_MODE_SWITCH_COOLDOWN_DAYS` (14) | not needed |
| Save lists | no | `FREE_LIST_LIMIT` (1), replace any time | unlimited |
| Classes and class codes | no | no | yes |
| History | no | yes | yes |

Config (hub `wrangler.jsonc` vars): `ANON_FREE_MODE` (default `race`, a room-capable mode, C), `FREE_MODE_COUNT` (1), `FREE_MODE_CHOICES` (modes a free teacher may pick; default all), `FREE_LIST_LIMIT`, `FREE_TASTE_ROUNDS_PER_DAY`, `FREE_MODE_SWITCH_COOLDOWN_DAYS`, `TRIAL_DAYS` (0). The game reads `ANON_FREE_MODE` from its own config so anonymous play works with the hub down.

### Every paid action is decided on the server

| Paid action | Server check |
|---|---|
| Round start (single screen or room) | The game's new `POST /api/round/start {mode, list}` calls `authorizeRound`. The response is a round grant **and the round's questions, built on the server** from the shared quiz code (`src/shared/quiz.ts`, `round.ts`, A). The client needs that response to start a round. Anonymous rounds in `ANON_FREE_MODE` are authorized by the game Worker itself, without the hub. |
| Room creation | Every room-creation path, including the legacy `POST /api/rooms {set, questions, perQuestionMs}` path (A, `src/worker/index.ts` lines 12-13 and 942-945), gets a room pass: `anon` pass (free mode only) or a hub-minted pass. |
| Round inside a room | The round route (today it accepts `race`, `climb`, `dash`, `tower` from a host key or a player id, A, `src/worker/index.ts` lines 16 and 813) must also find the mode on the room's pass. A kid's player id can start only a mode already on the pass. |
| Taste round | `useTaste` (atomic); host only; the teacher-only upgrade card follows it |
| Mode switch | `switchFreeMode` (atomic) |
| List save | `saveList` (atomic free-list limit) |
| Class action | paid check inside `saveClass` and `deleteClass` |

The browser's cached `entitlement()` result only decides what the screen shows. **Residual risk, stated honestly (B):** someone who rewrites our JavaScript could build questions locally and play a single-screen mode offline. They get no rooms, no saved lists, no classes and no history. That is the same limit every browser game has.

### Where the vocab app changes

Repo `joydai2026-del/bilingual-vocab-game`, paths read today (A):

| File | Change | Slice |
|---|---|---|
| `src/worker/index.ts` | new `/auth/finish`, `/api/round/start`, `/api/me/*` routes calling HubService; room creation (all paths) makes a room pass; the round route checks the pass | S2b |
| `src/worker/room-do.ts`, `src/worker/persist.ts` | store the room pass in its own slot; move the hard-coded `ROOM_TTL_MS` (2 hours, `room-do.ts` line 70) into `policy.ts` | S2b |
| `src/worker/policy.ts`, `wrangler.jsonc` | `GAME_ID`, HubService binding, `ANON_FREE_MODE`, `ROOM_PASS_HOURS`, `GAME_SESSION_*` | S2b |
| `src/client/screens/set.ts` | mode cards: locked, taste available, cooldown date (extends the `skyTowerDisabledReason` pattern, A) | S2b |
| `src/client/router.ts` | play routes ask `/api/round/start` before starting | S2b |
| `src/client/state.ts` | "Save to my lists", "Open my lists" through the game Worker | S1 |
| new `src/client/screens/upgrade.ts` | upgrade card, "Signed in as", sign-in button; teacher screens only | S2b |
| room join and ranking screens | room-only participant id; cumulative board | S3 |
| new `src/client/analytics.ts` | teacher-only loader | S4a |

## Stripe

### Objects (created by an idempotent setup script, read back after)

| Object | Value | Config key |
|---|---|---|
| Product | "Avery Classroom Games", `statement_descriptor` = `AVERY STUDIO`, metadata `app=avery` | `STRIPE_PRODUCT_ID` |
| Price, yearly | $39.00 USD every year, lookup key `avery_yearly_v1` | `STRIPE_PRICE_YEARLY` |
| Price, monthly | $6.99 USD every month, lookup key `avery_monthly_v1` | `STRIPE_PRICE_MONTHLY` |
| Webhook endpoint | `https://<hub>/stripe/webhook`, only the events below | `STRIPE_WEBHOOK_SECRET` |
| Portal configuration | cancel at period end, update card, invoice history; plan switch and cancel-now off | `STRIPE_PORTAL_CONFIG_ID` |

`avery-hub/scripts/stripe-setup.ts --env staging` refuses anything but a test key. `--env production --live` is a separate path that needs the live restricted key JJ issues in S5, finds objects by lookup key or metadata before creating (so re-running creates nothing twice), and ends with a readback that prints the product descriptor, both prices, the portal features and the webhook event list for JJ to compare. Stripe test and live objects are separate (B), so production is provisioned twice: in test mode during S1 to S4, in live mode in S5.

### Branding inside the Ownly account (honest limits)

| Surface | What the teacher sees | Grade |
|---|---|---|
| Bank or card statement | `AVERY STUDIO` from the product's `statement_descriptor`, which Stripe documents as "Only used for subscription payments", up to 22 characters; for a subscription charge Stripe uses the Invoice's descriptor, then the Product's, then the account default. Some banks show descriptors wrongly or not at all. | A (https://docs.stripe.com/api/products/object, https://docs.stripe.com/get-started/account/statement-descriptors) |
| Top of the Checkout page | "Avery Studio" via the Checkout Session's `branding_settings.display_name`, which overrides the business name only at the top of the page; Stripe says the business name "still appears in terms, receipts, and other places" | A (https://docs.stripe.com/api/checkout/sessions/create) |
| Receipt emails, Customer Portal, Checkout terms | Ownly Network LLC's account name and branding; the line item says "Avery Classroom Games" | A for receipts and terms (same page), B for the portal |

So a teacher will see Ownly Network LLC on receipts. That follows from decision 2; the only way around it is a separate Stripe account, which JJ declined.

### Customer mapping and no double purchase

| Rule | How |
|---|---|
| One Stripe customer per teacher | at first checkout, create the customer with `metadata.teacher_id` and idempotency key `customer:<teacher_id>`; store `stripe_customer_id` (UNIQUE) on the teacher; reuse it for every later checkout |
| Mapping in every object | Checkout Session with `customer`, `client_reference_id` = teacher id (A, the parameter exists on the create page), `subscription_data.metadata.teacher_id`, `metadata.app=avery` |
| Event order does not matter | `customer.subscription.created` can arrive before `checkout.session.completed`; both carry the teacher id in metadata, and both lead to the same fetch-latest write |
| No double purchase | `/billing/checkout` refuses when she already has access, or when an unexpired Checkout Session from her is still open (it returns that session instead) |
| Two active subscriptions anyway | reconciliation alerts JJ; the admin runbook refunds and cancels the newer one |
| Outgoing idempotency keys | every mutating Stripe call carries one: `checkout:<teacher_id>:<checkout_code>`, `customer:<teacher_id>`, `refund:<charge_id>:<op_id>`, `cancel:<subscription_id>:<reason>:<op_id>` |

### Webhook processing (serialized per customer)

Events handled: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.

1. Verify the signature on the raw body with the CRM verifier. Failure is 401, never 500.
2. Ignore anything that is not Avery's (no `app=avery` metadata and no Avery price): record it and return 200.
3. `INSERT OR IGNORE` the event with status `received`. If it already exists with status `processed`, return 200.
4. Call `enqueue(eventId)` on the **BillingDO** for that Stripe customer. The DO writes the event id into a queue in **its own durable storage** and sets an alarm, and `enqueue` returns only after that write is committed. Only then does the route return 200.
5. The DO processes its stored queue one event at a time (started right away and again by the alarm), so two events for one teacher never race (B: a Durable Object does not interleave its own storage operations). For each event it fetches the latest Subscription, its latest invoice's charge (amount refunded) and any dispute from Stripe; computes `accessFor`; then writes the subscription row, bumps `entitlement_version` if access dropped, and marks the event `processed`, all in one `db.batch()`. Only after that batch succeeds does it remove the event from its storage queue.
6. On any error the event stays in the DO queue; `attempts + 1` and `last_error` are saved in DO storage and in D1 (status `failed`), and the alarm retries with backoff (`WEBHOOK_RETRY_BASE_SECONDS` 30, doubling, capped at 1 hour). An inserted-but-unprocessed event is **retried**, never skipped. The hourly cron also re-enqueues any D1 row still `received` or `failed` older than 10 minutes, as a backstop.
7. `attempts >= ALERT_AFTER_ATTEMPTS` (3) sends an alert.

**Acknowledgement contract:** Stripe gets a 2xx only after the event is durably written to the BillingDO's storage queue; from that moment the DO, not Stripe's retries, owns the event until the D1 batch marks it processed.

**Crash test:** enqueue an event, then kill the DO before the D1 batch runs; on restart the alarm must process it exactly once, and a second delivery of the same event from Stripe must not process it twice. A second test deletes the DO queue entry by hand and checks that the hourly D1 backstop still finishes the event.

The CRM's exactly-once claim runs inside a Postgres transaction (A, per the Claude review, `crm/front-desk/src/payments/stripe.ts`); D1 cannot hold a transaction across calls, which is why the durable Durable Object queue and the single batch replace it here.

### State model: `accessFor`

`accessFor(subscription, latestCharge, dispute, refundOps, now, policy)` is a plain function with one test per row. It never reads access from the subscription alone.

| Input state | Access | Config |
|---|---|---|
| `incomplete` (first payment not finished) | free | none |
| `incomplete_expired` | free | none |
| `trialing` | paid until trial end | `TRIAL_DAYS` (0) |
| `active` | paid until `current_period_end` + grace | `ACCESS_END_GRACE_DAYS` (7) |
| `past_due` | paid during grace | `PAST_DUE_GRACE_DAYS` (7) |
| `unpaid` | free | none |
| `paused` | free | none |
| `active` with `cancel_at_period_end` | paid until period end + grace, then free | `ACCESS_END_GRACE_DAYS` |
| `canceled` | free | none |
| latest paid charge **fully refunded** (even if the subscription still says `active`) | free | none |
| partial refund | no change | none |
| dispute open | paused (free) while open | `DISPUTE_ACTION` (pause) |
| dispute won | back to what the subscription says | none |
| dispute lost | free; subscription cancelled | none |

**Refunds never get re-granted.** A refund does not cancel a subscription by itself; they are separate Stripe operations (B). So:

- **Ordered refund-then-cancel workflow** (admin tool and runbook): step 1 refund with key `refund:<charge>:<op>`; step 2 cancel the subscription immediately, no proration, key `cancel:<sub>:refund:<op>`; step 3 mark `refunded_full`, bump `entitlement_version`. Each step is recorded in `billing_ops` and can be re-run safely until all three are done.
- If JJ refunds in the Stripe Dashboard instead, the `charge.refunded` event (full amount) makes the BillingDO run steps 2 and 3.
- Reconciliation reads the same inputs as the webhook (subscription + latest charge + dispute) and **never** clears `refunded_full` or an open dispute from a subscription fetch alone.
- A lost dispute cancels the subscription the same way, so Stripe does not charge her again next year.

### Reconciliation (daily, `RECONCILE_HOUR_UTC`)

- Lists **Stripe's** subscriptions for both Avery prices (all statuses), not just the ones in D1, and maps each by `metadata.teacher_id`. An Avery subscription with no known teacher raises an alert.
- Lists refunds and disputes from the last 35 days on Avery charges.
- Runs each customer through its BillingDO, so reconciliation and webhooks never race.
- Alerts when it fixed anything, when a teacher has two active subscriptions, or when it did not run by `RECONCILE_HOUR_UTC` + 2 hours (checked by the hourly cron).

**Alert channel:** a GitHub issue on this repo, labelled `avery-alert`, opened with a fine-grained token that can only write issues here (`ALERT_GITHUB_TOKEN`). GitHub's own notification email reaches JJ. This is the same delivery pattern the joydong.org weekly report moved to on 2026-08-24 (A, `docs/2026-08-13-analytics-setup.md`). The channel is config (`ALERT_CHANNEL`), so it can change without code.

### Existing webhooks on the Ownly account

S2a starts with a read-only inventory of every webhook endpoint on the Ownly Network LLC account (Agent Company ran one behind `api.ownlyagent.com`, A per the board). For each: URL, events, status. Any live endpoint that subscribes to charge or subscription events must ignore Avery objects (`app=avery`); the result is written to `avery-hub/docs/ops/stripe-webhook-inventory.md` before the Avery endpoint is added.

### Refund policy and economics

- Default: yearly, full refund within 14 days of the first purchase **and of each yearly renewal**, no questions asked (`REFUND_WINDOW_DAYS` 14). Monthly: cancel any time, no refund.
- Moving from monthly to yearly: portal plan switch is off, so JJ does it from the Dashboard on request (runbook).
- Stripe does not return processing fees on refunds; the board estimated about $1.70 lost per $39 refund (A for "not returned", C for the amount, https://docs.stripe.com/refunds). Refunds need available balance or wait as pending (A, same page). S5 records the real fee lines from the first live charge's balance transaction and confirms whether the Billing fee is credited back, before any net-revenue number is published.
- Receipts: turn on successful-payment and refund receipt emails and the renewal reminder before a yearly renewal (Stripe settings, B). Stripe does not send automatic receipts for test-mode payments, only a manually sent test receipt (per the Codex round-2 review, citing https://docs.stripe.com/receipts; B, not re-read here), so the receipt template is checked with a manual test receipt in test mode, and automatic delivery is proven on the first live purchase in S5. The pricing card and Checkout (`custom_text`) say plainly that the plan renews automatically, its price, and how to cancel (C, US auto-renewal rules).

### Tax gate before live mode

Seller: Ownly Network LLC. Stripe Tax collects only where registrations have been added; the business decides where it owes tax (A, https://docs.stripe.com/tax/registering). Before S5: JJ and her accountant confirm the home state, whether a digital teaching subscription is taxable there, the product tax code, and any registrations; then Stripe Tax is switched on. This plan does not guess any of those.

### Secrets (names only; separate values for staging and production)

| Secret | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | restricted key; test in staging, live in production from S5 |
| `STRIPE_WEBHOOK_SECRET` | webhook signature (the verifier accepts several `v1` values while a secret is rolled, A) |
| `GOOGLE_CLIENT_SECRET` | Google sign-in |
| `SESSION_HASH_KEY_V1`, `SESSION_HASH_KEY_V2` | hash sessions, game sessions, hand-off tokens and checkout codes (overlapping versions) |
| `GAME_KEY_<GAME_ID>` (hub side stores only the hash) | proves which game is calling HubService |
| `ALERT_GITHUB_TOKEN` | alert issues |
| `CF_ACCESS_SERVICE_TOKEN` (held by the admin CLI, not the hub) | reach `/admin/*` |

Config, not secrets: `GOOGLE_CLIENT_ID`, `POSTHOG_PROJECT_KEY` (public by design), price ids, portal config id, all limits and grace periods, `GAME_REGISTRY`, `SESSION_HASH_KEY_CURRENT`, `ALERT_CHANNEL`, `STRIPE_MODE`.

### Reuse from the CRM

Copy `front-desk/src/payments/webhook-verify.ts` from `joydai2026-del/crm` (last changed in commit `de8d4ca`) into `avery-hub/src/stripe/webhook-verify.ts` with a header naming the source. It uses Web Crypto only, checks a 5-minute window, rejects malformed or wrong-length signatures and compares in constant time (A). Port its signature tests from `front-desk/test/stripe-webhook.test.ts`: valid, wrong value, wrong length, stale timestamp, missing header, malformed header, unhandled type acknowledged (A). The 300-second window becomes `STRIPE_SIGNATURE_TOLERANCE_SECONDS` in config.

## Rankings

| Item | Rule |
|---|---|
| 1-hour class board (builds in S3) | The nickname the child types to join (as today) plus a **room-only participant id**: random, made when she joins, kept in session storage so a reload rejoins the same room, gone when the room closes. No id in local storage, nothing that links her across rooms or days, nothing read about the device. |
| Where it lives | Only in the game's Room Durable Object, which already keeps a live ranking (A, `src/client/room/ranking.ts`) and deletes the room after its time to live. Nothing about kids goes to D1 or to the hub. |
| What the class sees | a cumulative board by points across every round in that room, on the teacher's screen and every tablet; participant ids are never sent to tablets |
| How long | `RANKING_KEEP_MINUTES` (60) of inactivity, then the board starts over; the room itself follows `ROOM_TTL_MS`, moved to config |
| Never stored | real names on purpose, email, photo, voice, IP address, location, device details. The join screen says "use a nickname"; children will still type real names sometimes, so nicknames are deleted with the room and never leave it. |
| Law | The FTC treats a persistent identifier as personal information unless it is used only for "support for internal operations" and nothing else personal is collected; a nickname counts only when it works as contact information (A, https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions, sections A and J). A room-only id that dies with the room is the smallest version of that (C). |
| **Long-term class ranking: BLOCKED** | Not built in this plan. Unblocking needs, written and reviewed by a privacy lawyer: a school and parent notice, a consent path (a school can consent for parents only for school use with no other commercial purpose, and must get full notice, A, same FAQ section N), a retention limit, a reset, deletion on request, and a no-commercial-reuse rule. A teacher switch alone is not consent. |
| Older kids with school Gmail | Later, same consent path. |

## Analytics (teacher screens only)

| Item | Rule |
|---|---|
| Tool and settings | PostHog, copying joydong.org's `assets/analytics.js` settings: memory persistence (no cookies), `$ip` null and geoip off, query strings and URL fragments stripped, feature flags off, no session recording, no autocapture, external script loading off (A, repo `joydai2026-del/joydong.org`, live site checked 2026-09-28). |
| Environments | a separate PostHog project for staging, or analytics off in staging (`POSTHOG_ENABLED`). |
| Who is sent | `analytics_id`, a random id on the teacher row; never email, name, Google id or word lists. |
| Where it loads | teacher screens only. The app is a single page that does not reload between screens, so the loader also **shuts PostHog down and drops it** whenever the route changes to a kid screen (join, play on a tablet, room board). |
| Server events | money events are sent by the hub after Stripe confirms. |
| Retention and deletion | PostHog retention set to the shortest plan window. Deleting a teacher deletes her `analytics_id` mapping, so her past events can no longer be tied to anyone (C). |
| Privacy notice | the averystudio.org privacy policy (S0) describes teacher analytics. joydong.org's analytics file says its privacy page must change in the same commit as any analytics change (A); the Avery pages follow the same rule. |
| Tests | (1) opening every kid route fresh: no request to a PostHog host, no `window.posthog`; (2) navigating from a teacher screen into a kid route: PostHog is shut down and no further request is sent; (3) a word list in the URL fragment never appears in any request; (4) deleting a teacher removes her `analytics_id`. |

Events:

| Event | When | Extra detail | Slice |
|---|---|---|---|
| `teacher_signed_in` | Google sign-in finished (server) | first time or returning | S4a |
| `list_saved` | she saves a list (server) | word-count band, never the words | S4a |
| `free_list_replaced` | free teacher overwrites her list (server) | none | S4a |
| `round_started` | she starts a game from her screen | mode, room or single screen, player-count band | S4b |
| `free_mode_switched` | free teacher switches mode | from, to | S4b |
| `switch_blocked_cooldown` | switch tried inside the cooldown | days left | S4b |
| `taste_round_played` | taste round starts | mode | S4b |
| `upgrade_card_shown` | upgrade card appears | where | S4b |
| `checkout_started` | she taps a plan | plan | S4b |
| `subscription_changed` | hub, after Stripe confirms | started, renewed, cancel scheduled, ended, refunded; plan | S4b |

AEO (answer engine optimisation) for the games marketing page is a separate, later plan: one clear page per game with plain questions and answers, structured data, the demo video, and AI crawlers allowed. joydong.org's weekly report already counts AI fetches and can measure it (A for the report, C for the approach).

## Teacher data lifecycle

| Item | Rule | Config |
|---|---|---|
| Email change | email and display name refreshed from Google on every sign-in; identity stays `sub` | none |
| Two Google accounts | two separate teachers; merge only by JJ with the admin `moveTeacher` tool after checking the Stripe receipt | none |
| Lost school account | she signs in with a new Google account and writes to the support address; JJ checks the receipt number and old email, runs `moveTeacher` (lists, classes, history, subscription, Stripe customer metadata), every old session is revoked, and `admin_log` records it | none |
| Export | "Download my data" on the profile page: JSON of lists, classes, history and a subscription summary | none |
| Delete my account | profile button, confirmed twice: cancels any Stripe subscription immediately (no refund outside the refund window), revokes every session, deletes lists, classes, history, game sessions and the teacher row, drops the analytics mapping. Stripe keeps its own invoices and payments, which Ownly Network LLC needs for tax (B). | none |
| After paid access ends | extra lists and classes hidden, not deleted, for 90 days, then deleted | `KEEP_AFTER_END_DAYS` (90) |
| Unused free profile | deleted after a long gap without sign-in; long enough to cover summer break, so a teacher returning in September still has her list | `INACTIVE_DELETE_DAYS` (400, C) |
| Deleted Google account | she can no longer sign in; the profile ages out under the rules above or JJ deletes it on request | none |

## School invoice and purchase-order route

A plain "Need a school invoice or purchase order?" link on the pricing card and the profile page opens an email to the support address with a short template (school, teachers, billing contact). JJ's runbook (`avery-hub/docs/ops/school-po.md`): send Ownly Network LLC's W-9 and vendor form; store any tax-exempt certificate and mark the Stripe customer exempt; send a Stripe invoice with net-30 terms (0.4% per paid invoice, A per board); on payment, add seats with the admin `grantSeats(emails, until, school)` tool, which writes `seat_grants`. A teacher whose verified Google email matches a seat is attached at sign-in. Renewal: a yearly reminder issue opened by the cron 30 days before `access_until`.

## House-rule rewording (its own small change, JJ approves)

Today (A, `CLAUDE.md` and `AGENTS.md` line 14): "No accounts, no ads, no tracking, no personal data stored beyond a display name for the life of a room."

Proposed, narrowly:

> No kid accounts, no ads, no tracking of kids. Teachers may sign in with Google (no passwords) to save lists, classes and a subscription, and teacher screens only may send product analytics. Kids never sign in and never load analytics; a kid's data is a nickname and a room-only id for the life of a room.

The agent-native rule (line 13) stays exactly as it is. How it holds: an agent still joins rooms through the same HTTP API as kids, unchanged, and can host anonymous free-mode rooms and rounds through the same routes a teacher uses. A paid agent path (a teacher-issued API key through the hub) is a known gap per the house agent-native rule and is listed under follow-ups, not built here.

This ships as its own reviewed PR in S0, not inside a code slice.

## Environments and release operations

| Item | Staging | Production |
|---|---|---|
| Hub Worker | `avery-hub-staging` | `avery-hub` on `hub.averystudio.org` |
| D1 database | `avery_hub_staging` | `avery_hub` |
| Google project and client | staging (Testing status) | production (published) |
| Stripe | test mode objects, test webhook | test mode through S4, live mode from S5 |
| Secrets and keys | own values | own values |
| Game registry and return URLs | staging games | production games |
| PostHog | off or staging project | production project |
| Alerts | issues labelled `avery-alert-staging` | `avery-alert` |

| Operation | Rule |
|---|---|
| Migrations | numbered files, additive only (new tables and columns; never drop or rename in the same release), applied to staging, then production, **before** the code that needs them deploys |
| App rollback | `wrangler rollback` to the previous version (B); because migrations are additive, the previous version still runs |
| Migration rollback | a forward fix migration; destructive changes only after one release with no reader |
| Backup and restore | D1 Time Travel restore rehearsed once on staging in S1 (B; the window depends on the Cloudflare plan, checked in S1), plus a weekly `wrangler d1 export` kept in private storage, never in git |
| Key rotation | overlapping versions for the hash key; Stripe webhook secret rolled with both secrets accepted; Google client secret rotated in the console; each has a written step in `avery-hub/docs/ops/rotation.md`; every 6 months or on any leak |
| Manual unlock and revoke | admin `grantAccess(teacher, until, reason)` and `revokeAccess(teacher, reason)`, both bump `entitlement_version` and sign out every session on revoke; tested at launch |
| Refund and dispute runbooks | `avery-hub/docs/ops/refund.md` (the ordered refund-then-cancel workflow), `dispute.md` (who answers, where evidence lives, the deadline Stripe shows) |
| Support route | a support address on averystudio.org that reaches JJ, shown in the footer, the privacy policy, Checkout and Google's consent screen; creating it is a JJ step |
| Receipt email | receipt template checked with a manual test receipt in test mode; automatic delivery proven on the first live purchase (S5) |
| Live provisioning | `stripe-setup.ts --env production --live` with the JJ-issued live key, then the readback |

## Slices

Effort counts one working day of one build session. "Review" is the reviews the house rules require and their fix rounds: the full 4-reviewer panel (three Claude lenses plus Codex, no round cap) for S1, S2a, S2b and S5; the default panel (one Claude reviewer plus Codex) for S0, S3, S4a and S4b. Estimates are judgement (C).

| Slice | Work | Build | Review | Total | Parallel with | Depends on | Files it owns |
|---|---|---|---|---|---|---|---|
| **S0** Legal, accounts, rule | Draft privacy policy, terms and refund policy pages for averystudio.org (JJ approves the wording); support address (JJ creates); Google Cloud staging and production projects and consent screens; hub custom domain; house-rule reword PR | 1 | 0.5 | 1.5 | S2a | JJ approvals | `joydong.org` legal pages, `CLAUDE.md`, `AGENTS.md` |
| **S1** Hub core | `avery-hub/` Worker, staging env, D1 migrations, `forTeacher` layer, HubService RPC with game registry, token protocol and TokenDO, hub and game sessions, device limit, sign-out, lists and classes, profile, export and delete, admin module behind Access, isolation and concurrency tests, Time Travel rehearsal; vocab app sign-in and "My lists" | 4.5 | 1.5 | 6 | S2a | S0 (the staging Google client) | `avery-hub/src/{db,rpc,auth,admin}`, vocab `state.ts`, vocab `/auth/finish` |
| **S2a** Stripe setup and state model | webhook inventory; idempotent setup script with readback (staging); `accessFor` with a test per row; CRM verifier and tests copied | 1.5 | 0.5 | 2 | S0, S1 | JJ-issued **test** restricted key | `avery-hub/src/stripe/`, `scripts/stripe-setup.ts` |
| **S2b** Billing and gate | Checkout (customer reuse, idempotency, branding, auto-renew text), return check, BillingDO webhooks, reconciliation, alert channel, refund-then-cancel tool and runbooks, seat grants; server-side gate: `authorizeRound` with server-built questions, room passes on every room path, round route checks, taste, switch, list limit; anonymous free path; hub-down tests; full test-mode run on staging | 4.5 | 1.5 | 6 | S4a | S1, S2a | `avery-hub/src/billing/`, vocab `index.ts`, `room-do.ts`, `persist.ts`, `policy.ts`, `set.ts`, `router.ts`, `upgrade.ts` |
| **S3** Rankings | room-only participant id, cumulative 1-hour board, config for keep minutes and room TTL, tests that no id reaches tablets or local storage, and that the room-only id and nicknames are cleared on room close, expiry and teacher reset | 1.5 | 0.5 | 2 | S4b | S2b (room pass, same room files) | vocab room join and ranking screens, `ranking.ts`, `room-do.ts` ranking slot |
| **S4a** Analytics base | loader with teacher-only rule and route-change shutdown, server events for sign-in and lists, the four analytics tests, privacy wording hand-off to S0 | 1 | 0.5 | 1.5 | S2b | S1 | new vocab `analytics.ts`, `avery-hub/src/analytics/` |
| **S4b** Gate events | the seven gate and money events; pricing-test report script | 1 | 0.5 | 1.5 | S3 | S2b, S4a | event calls in `set.ts`, `router.ts`, `upgrade.ts` (after S2b merges) |
| **S5** Live | live key, live provisioning and readback, live portal, live webhook, automatic receipt proven on the first live purchase, one real purchase, cancel and refund on the live site, real fee lines recorded, demo re-recorded on the live site, six-month checklist items set up | 1.5 | 0.5 | 2 | none | S2b, S3, S4b, S0 (pages live, consent screen published), tax gate, staging acceptance | ops docs |

**Totals:** build 16.5 days, review and fix rounds 6 days: 22.5 days of work, **about 27 with 20% contingency**.

**Elapsed time:**

| Way of working | Path | Days |
|---|---|---|
| Parallel sessions (S2a beside S0 and S1; S4a beside S2b; S3 beside S4b) | S0 (1.5) then S1 (6) then S2b (6) then S3 or S4b (2) then S5 (2) = 17.5 | **about 21 working days with contingency** (17.5 base) |
| One session at a time | every slice in a row, 22.5 | **about 27 working days with contingency** (22.5 base) |
| Plus, outside our control | JJ approving legal wording, publishing the consent screen and Google's brand review (can take days, B), issuing Stripe keys, the tax gate | added on top |

The 20% contingency (for a first Google and Stripe integration in this stack, C) is already in the headline numbers above.

```
S0 --> S1 --+--> S2b --+--> S3 ---+
S2a --------+          +--> S4b --+--> S5 (after tax gate, S0 pages live, consent screen published)
S1 --> S4a (beside S2b) --> S4b
```

## Six-month operations checklist (S5 exit criteria)

| Item | Check | How often |
|---|---|---|
| Portal configuration | test and live portals allow the same three actions | at launch and after any change |
| Cancel timing and plan changes | cancel at period end tested; monthly-to-yearly runbook tested | at launch |
| Failed-payment recovery | Stripe retries and reminder emails on; our grace matches | monthly |
| Webhook failures | alert fires when deliveries fail or the endpoint is disabled | always on |
| Reconciliation | ran, and alerts on drift or a missed run | daily |
| Google sign-in | client secret rotation; callback list current; a real school account still signs in | each school term |
| Disputes | runbook owner, evidence location, Stripe's deadline | per dispute |
| Refund balance | enough available balance, or refunds sit pending | monthly |
| Key rotation | hash keys, webhook secret, Google secret, game keys | every 6 months or on a leak |
| Data deletion | retention crons ran; delete-on-request tested | monthly |
| Manual unlock and revoke | tested | at launch |
| Per-teacher separation | isolation tests pass on every deploy | every deploy |
| Backups | weekly export present; restore rehearsed | weekly, rehearsal each term |

## Risks

| Risk | Grade | What we do |
|---|---|---|
| A district blocks outside apps on teacher Google accounts | B | test with a real school account in S1; email magic link (board option B2) is the fallback, about 1 more day |
| Consent screen stays in Testing (100-user cap) because legal pages or domain verification are late | B | S0 starts on day 1, beside S1 |
| Receipts show Ownly Network LLC, not Avery | A | stated on the pricing card: "Billed by Ownly Network LLC as AVERY STUDIO" |
| Bank shows a different name than AVERY STUDIO | A (Stripe warns banks vary) | checked on the first test and live charge |
| Someone rewrites our JavaScript to play a single-screen mode offline | B | accepted; no rooms, lists, classes or history that way |
| Hub outage | C | failure matrix above; anonymous free play does not depend on the hub |
| Refund later re-granted by reconciliation | B | `accessFor` reads charges and disputes; reconciliation never clears `refunded_full` |
| Long-term ranking stays blocked | C | listed as blocked with its unblock list; not silently dropped |
| Tax registrations take longer than the build | C | S0 to S4 run in test mode meanwhile; S5 waits |
| `admin@ownly.network` domain lapses and the Stripe account's public support email dies | A | check the renewal date or change the public support email before S5 |

## QA bar (before anything reaches JJ)

1. Static checks: `tsc --noEmit` on the hub and the vocab app.
2. Tests green: `accessFor` rows, token protocol, gate rules, concurrency tests, isolation tests, webhook tests, hub-down tests, analytics tests.
3. Live surface on the **staging hub** and a staging vocab app: real Google sign-in (two accounts in one browser), save a list, anonymous room in the free mode, signed-in room from a second tablet, taste round, test-card purchase, upgrade disappears, cancel in the portal, refund then cancel, access follows the table, sign out everywhere reaches the game. State what was checked live and what is still assumed.
4. Visual check: open and look at the upgrade card, "Signed in as", profile, mode picker, device picker and ranking on a phone and a tablet.
5. Re-record the vocab app demo on the live site after S5, per the repo's demo rule.
6. Reviews per slice as listed above; Codex reviews before anything is handed to JJ.

## Open questions for JJ (each default stands unless she changes it)

| Question | Default |
|---|---|
| Tax registrations: Ownly Network LLC's home state, taxability, any other states | JJ and her accountant confirm before S5 |
| Refund window | 14 days full on yearly, first purchase and each renewal; monthly cancel anytime, no refund |
| Devices per teacher | 3, with a "which device to sign out" picker at the limit |
| Who owns the Google Cloud projects | the same Google account that holds the Stripe login |
| Support address shown on receipts, Checkout and the consent screen | a new averystudio.org address that reaches JJ |
| Which mode anonymous teachers get | `race` (config `ANON_FREE_MODE`) |

## Follow-ups (not in this plan)

- Paid agent path (a teacher-issued API key through the hub), per the agent-native rule.
- Long-term class ranking, after the consent path above.
- Moving games under averystudio.org (the hand-off keeps working there).
- AEO plan for the games page.

## Round-2 review trace

| Review item | Where answered |
|---|---|
| RPC-only internal API, caller and audience checks, public 404 test | "The internal API is RPC only" |
| One token protocol, login CSRF, game sessions minted by the hub, lifetimes, rotation, revocation | "One token protocol", "Sign-in and hand-off flow" |
| Hub-down failure matrix, room pass fields, verification, revocation | "When the hub is down or broken" |
| D1 constraints, route-level isolation tests, atomic writes, webhook serialization, retry of unprocessed events | "Data model", "Atomic writes", "Webhook processing" |
| Server-side gate for every paid action, free mode as config, URL lists | "Free and paid gate" |
| Stripe idempotency keys, incomplete and paused states, refund and dispute in `accessFor`, refund-then-cancel, customer mapping, Stripe-side reconciliation, attempts and alerts, branding limits | "Stripe" |
| Room-only participant id, long-term ranking blocked | "Rankings" |
| Google environments, `select_account`, test-user cap, sign-out, email change, delete and export, retention, recovery | "Google environments", "Teacher data lifecycle" |
| Staging and production separation, live provisioning, receipts, support, runbooks, rotation, backup, rollback, unlock and revoke, legal pages, school route, webhook inventory | "Environments and release operations", "School invoice", S0 |
| Honest schedule with reviews, corrected parallel labels | "Slices" |
| Pricing thresholds in the plan | "Pricing test" |
| Narrow house-rule reword, agent-native kept | "House-rule rewording" |
| Brief priority 5 moved up | Decisions, row 8 |
| Anonymous free play decision | Decisions, row 7; "Who may do what" |
| Codex 7 (recovery), 10 (refund economics), 12 (school route), 14 (ops checklist) | "Teacher data lifecycle", "Refund policy and economics", "School invoice", "Six-month operations checklist" |

## Sources read for this plan

- Owner feedback: vault `projects/little-games/evidence/2026-09-28-pricing-board-feedback-round1.md`
- Plan reviews: `/Users/joyd/lg-scans/review-pr18-plan-claude.md`, `/Users/joyd/lg-scans/review-pr18-plan-codex.md`
- Codex challenge: `/Users/joyd/lg-scans/pricing/challenge-codex.md`
- Pickup brief: `docs/avery/AVERY-CLASSROOM-GAMES-PICKUP.md` (this repo, main), line 50
- CRM: `front-desk/src/payments/webhook-verify.ts`, `front-desk/test/stripe-webhook.test.ts`
- Vocab app: `src/client/screens/set.ts`, `src/client/state.ts`, `src/client/router.ts`, `src/client/room/ranking.ts`, `src/shared/quiz.ts`, `src/shared/round.ts`, `src/worker/index.ts`, `src/worker/room-do.ts`, `src/worker/persist.ts`, `src/worker/policy.ts`
- joydong.org: `assets/analytics.js`, `docs/2026-08-13-analytics-setup.md`; live https://joydong.org
- https://developers.cloudflare.com/workers/runtime-apis/rpc/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://docs.stripe.com/api/checkout/sessions/create
- https://docs.stripe.com/api/products/object
- https://docs.stripe.com/get-started/account/statement-descriptors
- https://developers.google.com/identity/openid-connect/openid-connect
- https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- https://publicsuffix.org/list/public_suffix_list.dat
- Round-1 board sources (Stripe webhooks, refunds, tax registering, multiple accounts, pricing): see the decision board
