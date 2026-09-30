---
date: 2026-09-28
revised: 2026-09-29
topic: Avery accounts and pay (Google sign-in, D1, Stripe under Ownly Network LLC)
status: plan version 3.2 (v3.1 after review round 1, then a final consistency patch from the round-2 reviews; no further review round)
branch: feat/avery-accounts-pay-plan
owner notes (private vault): projects/little-games/2026-09-29-avery-pay-jj-setup-steps.html, projects/little-games/2026-09-28-pricing-and-stripe-options.html
review files: see review files (local), not in this repo
---

# Avery accounts and pay: build plan (version 3.2)

## In one minute

- **One free round, then pay.** In each browser, without signing in, a teacher gets exactly ONE free round in each of the six games (the vocab app counts as one game). After that the game says "Sign in and subscribe to keep playing". No free plan, no free trial.
- **Paid = everything:** $29 a year or $4.99 a month. All six games and every mode, unlimited saved lists, classes with class codes, play history, the 1-hour class ranking, the Tianzige Generator and the Chinese writing-pack engine. The **yearly** plan also includes the printable packs and a "Tell us what you need" request button.
- **Sign in with Google** to subscribe. Her lists, classes, history and subscription follow her to any device. Two teachers' data never mix.
- **Kids** never sign in, never see a paywall or a price, never load analytics, and their internet address is never logged by the games. They type only a one-word nickname to join a room.
- **avery-hub** owns sign-in, the teacher database, Stripe, downloads and the answer to "may this teacher start this round?". It moves to its own **private** repo before billing is built (S0d). Each game stays its own Worker and asks the hub.
- **Money** goes through the existing **Ownly Network LLC** Stripe account; bank statements say **AVERY STUDIO**.
- **Schedule (20% contingency included):** about 30 working days to live with at most 3 builders and 1 review panel at a time (25.25 base), about 51 working days one session at a time (42.25 base). JJ-side waits (Google publishing, Stripe keys, tax check, licence check, legal wording) come on top.

Claim grades: **A** = read today in the named source, **B** = standard platform behaviour not re-read today, **C** = estimate or judgement.

## For JJ first (only you can do these)

| # | Item | Why it blocks | How |
|---|---|---|---|
| 1 | **Google Cloud: staging and production projects, consent screens, OAuth clients** | No teacher can sign in anywhere until these exist (the staging hub answers "Can't sign in right now", A) | owner setup guide (private vault, path in the header) |
| 2 | **Stripe access: a test-mode restricted key now, a live one at S5, a read key for the webhook inventory** | no real Stripe test-mode call has been made yet | same guide |
| 3 | **Accountant tax check** for Ownly Network LLC: home state, whether a teaching subscription that includes printable packs is taxable there, product tax code, any registrations | live mode (S5) waits on it | same guide; send the "Tax gate" section |

Non-blocking owner items: the per-file font and art licence check for the packs; the two legal-page placeholders (mailing address, governing-law state) plus a phone number or a lawyer's OK that email and address suffice for the children's notice; set the Stripe public business details (name "Avery Studio by Ownly Network LLC", support email `hello@averystudio.org`, Terms and Privacy URLs) and change the account's public support email away from `admin@ownly.network`; confirm `hello@averystudio.org` really receives mail; upload each re-recorded demo mp4 after S5 (the repo's demo rule).

## Decisions

### Decided by JJ

| # | Decision | Who, when | Where it lands |
|---|---|---|---|
| 1 | Teachers sign in with Google, stay signed in, and get a profile: lists, classes, history, subscription. Teachers' data never overlaps. Kids never sign in and never see a paywall. | JJ, 2026-09-28 | S1 |
| 2 | One Stripe account, Ownly Network LLC; seller for tax is Ownly Network LLC. | JJ, 2026-09-28 | S2a, S2b, S5 |
| 3 | A yearly and a monthly plan run as a pricing test (thresholds below). | JJ, 2026-09-28 | pricing test |
| 5 | S3 and S4 build side by side (both need S2d merged, 1.5); then S3 panel (0.5), S4 panel (0.5) one after the other; S3 fix (1) overlaps the S4 panel, S4 fix (1) follows: 1.5 + 0.5 + 0.5 + 1 | 3.5 |
| 6 | Student rankings students can see (1-hour board; long-term board blocked for the law, below). | JJ, 2026-09-28 | S3 |
| 8 | The paid gate moves ahead of the brief's order (brief priority 5). | JJ, 2026-09-28 | whole plan |
| 9 | **Hard paywall, no free tier.** "If they don't pay, then don't play." One free round per game (vocab app = one game), then "Sign in and subscribe to keep playing". No calendar trial. | JJ, 2026-09-29 | "The gate" |
| 10 | **$29.00 a year (`avery_yearly_v2`) or $4.99 a month (`avery_monthly_v2`).** v1 prices are never created in live mode. | JJ, 2026-09-29 | "Stripe" |
| 11 | **Paid = everything** (all six games and modes, unlimited lists, classes, history, the 1-hour ranking, the Tianzige Generator and the writing-pack engine); the **yearly** plan adds the brand's printable packs (after a font and art licence check) and a "Tell us what you need" request button (1 a month, filled by hand, 60-day pilot). How a pack is personalised is not JJ's decision; see D11. | JJ, 2026-09-29 | "Materials" |
| 12 | **Refunds:** yearly, full refund within 14 days of the first purchase and of each renewal, and a refund ends access; monthly, cancel any time, no refund. 7-day grace after a cancel at period end, only when the teacher asked for it. | JJ, 2026-09-29 | `accessFor` |
| 13 | **Hosting:** six games on `*.averystudio.org`; hub `hub.averystudio.org`, staging `avery-hub-staging.joyd-ai-2026.workers.dev`; support `hello@averystudio.org`; legal page `https://www.averystudio.org/legal/policies` (`#terms #privacy #children #refunds`); house-rule reword little-games PR #24 merges before the hub. | JJ, 2026-09-29 | S0c, S5 |
| 14 | **One live game session per game per hub session** (a new hand-off ends the previous game session of that game). | JJ, 2026-09-29 | built (S1) |

Rows 4 (free-mode switch and taste rounds) and 7 (unlimited anonymous play) of version 2 are superseded by row 9.

### Defaults set by the agent or coordinator (JJ may overturn any row)

**Decisions waiting for JJ:** D2 (JavaScript bypass in browser-run modes), D3 and D4 (revocation timing and the 24-hour outage cache), D8 (Dashboard trials), D9 (grant benefits), D10 (download cap). Each stands as written until she answers.

Each row says why, so a later review round cannot flip it silently.

| # | Default | Why |
|---|---|---|
| D1 | **Free round per browser, not per device.** JJ said "play it once for all the games" and "or whatever" on the mechanism (JJ, 2026-09-29); the agent chose a per-browser cookie. Clearing cookies, a private window or another browser gives another free round; parallel first requests from one browser may each get one. | A per-device limit needs a device fingerprint, which the house rules and the children's-privacy law rule out. The real wall is the paid grant. |
| D2 | **Browser-run modes can be bypassed by rewriting our JavaScript** (Tianzige preview, Missing Stroke solo, vocab single-screen modes). Accepted risk, **pending JJ**. Rooms beyond one round, saved lists, classes, history and downloads are never reachable that way. | Moving every mode's rendering to the server is a large rebuild for a small leak; the valuable parts are server-side already. |
| D3 | **(pending JJ)** **"Access ends at once" means:** a running round finishes; the NEXT round start is refused; a room re-checks its pass at every round start while the hub answers; with the hub down, the stored pass lasts until its expiry, which is that game's room lifetime plus 15 minutes, so a lesson is never cut mid-room. | Cutting a class off mid-round punishes kids for a billing event; the bound keeps the leak to one lesson. |
| D4 | **(pending JJ)** **Entitlement cache during a hub outage:** a game caches a paid answer for `ENTITLEMENT_CACHE_HOURS` (24) and grants rounds from it when the hub is unreachable, so revocation can lag up to 24 hours during an outage. | A paying teacher should not lose her class because our hub is down; outages are rare and short. |
| D5 | **Grace:** 7 days after period end only when the teacher asked for the cancel (Stripe `cancellation_details.reason` = `cancellation_requested`) and the subscription ran to its period end (`ended_at >= current_period_end`); an active paid subscription also gets the 7 days after its period end so a late renewal webhook never locks her out; never past the last PAID period plus the grace. | JJ's row 12, applied to how Stripe actually ends a period-end cancel (status becomes `canceled`, B). Matches the S2a code. |
| D6 | **Paused collection** (Dashboard `pause_collection`, status stays `active`): access only through the last PAID period end, no grace. | Nobody keeps access for time not paid for (coordinator, S2a fix round 2). A goodwill pause is JJ's manual grant instead. |
| D7 | **Past-due grace** 7 days (`PAST_DUE_GRACE_DAYS`), counted from the start of the unpaid period (the failed renewal); a renewal whose charge has not landed yet gets the same 7 days from the last paid period end. | Stripe retries failed cards for days (B); a card problem should not end a lesson the same morning. |
| D8 | **(pending JJ)** **Manual trials** are honoured to their `trial_end` if someone ever creates one in the Dashboard; `TRIAL_DAYS` stays 0. | A trial only exists if JJ set it on purpose. |
| D9 | **(pending JJ)** **Seat and manual grants count as yearly** for packs and requests (`GRANT_COUNTS_AS` = `yearly`). | School purchase orders are yearly by nature. |
| D10 | **(pending JJ)** **Download cap 20 a day** (`DOWNLOADS_PER_DAY`, UTC day). | Stops bulk scraping; far above what one teacher prints. |
| D11 | **Packs are stamped with the teacher's sign-in email and the UTC date** ("Licensed to x@school.org, 2026-09-29"), never her display name; an email with a non-ASCII local part falls back to her short teacher id; a non-ASCII domain prints in punycode. | Emails fit the built-in Helvetica font, so no Chinese font file or second PDF dependency is needed; a display name like 王老师 would not print. |
| D12 | **Anonymous rooms:** the free round is used up at room creation (cookie checked and set there); round starts inside the room check only the room's pass, which allows exactly one round. | Checking the cookie again at `/start` would refuse the free round the room just granted (Dictation Dash solo is a room, A). |
| D13 | **Monthly pro-rata refund after a price rise:** a monthly teacher who cancels within 14 days after her first charge at a higher price gets back the unused part. This is the one narrow exception to "monthly, no refund", which otherwise stands as JJ decided (row 12). | Legal: New York GBL 527-a(1)(b-1) requires either consent to the higher price or this 14-day pro-rata cancel. |

**Kept from version 2, for the law.** A device id that lives in the browser links a child across rooms and days, which the FTC treats as personal information unless used only to run the service (A, FTC COPPA FAQ, read 2026-09-28). So the 1-hour board uses a **room-only participant id**, and the **long-term class ranking stays BLOCKED** until a school and parent notice and consent path exists.

## Current state (exact)

Version 2 of this plan had two review rounds, **both FIX-FIRST**, with fixes applied after each. Version 3 had one round (both FIX-FIRST); this file is the fix.

| Capability | Branch, head | Tests | Deployed | Live-verified | Review state |
|---|---|---|---|---|---|
| S1 hub core: Worker, D1 schema, `forTeacher`, Google OIDC code (no client yet), hub and game sessions, device limit, TokenDO hand-off, HubService (sessions, lists, classes, room passes), profile, export, delete, admin behind Access | `origin/feat/avery-hub`, `85901f9` (A) | 118 (coordinator, not re-run) | staging, D1 `avery_hub_staging` (A, S1 report) | public surface only (A); no real sign-in | round 1 full panel FIX-FIRST; fix round 1 landed (`4466baf`, `ffc60a4`, `85901f9`); round-2 panel not yet run |
| **Not built:** billing, Checkout, BillingDO webhooks, reconciliation, `authorizeRound`, downloads, requests | none | none | no | no | S2b, S6 |
| S2a Stripe model: REST client, CRM webhook verifier, `accessFor`, event routing, idempotency keys, setup script with read-only discovery and gates | `origin/feat/avery-stripe-model`, `a3e29d1` (A) | 186 at `a3e29d1` (coordinator, not re-run) | nothing deployed; no real Stripe call | no | rounds 1 and 2 fixed; **fix round 3 in progress** |
| S0b legal page and house rule | joydong.org PR #88; little-games PR #24 | n/a | not published | no | two review rounds each; the page still describes version 2 (S0c) |
| Custom domains for the five little-games Workers | little-games PR #23, merged (A) | per game | yes (A) | yes, live gates passed (A) | done |

What S1 already built from this plan (A, `85901f9`, HUB-API doc): one game session per game per browser (row 14); `FREE_TIER_ENABLED` = `false` by default, so `useTaste` and `switchFreeMode` are refused; `entitlement` returns `{ plan: "free" | "paid", accessUntil }` ("free" means not subscribed); every method may return `unavailable` and never throws across RPC; `DB_READY` guard; `AUTH_ADDRESS_LIMITER` abuse bucket; rotation keeps the previous session id valid for `SESSION_ROTATE_OVERLAP_SECONDS` (30); migrations `0001_init.sql` and `0002_rotation_overlap.sql` exist, so the next is **`0003_v3.sql`**. Open finding counts: S1 round 1 is fixed pending re-review; S2a is in fix round 3 (details kept privately, not in this public file).

## Pricing test (the rules, written in)

In `config/pricing-test.json` (hub repo), read by an agent-callable report script built in S4. Thresholds unchanged from version 2; prices are now **$29.00 a year and $4.99 a month**.

| Rule | Threshold | Config key | Data source |
|---|---|---|---|
| When to judge | 60 days after live launch or 30 paying teachers, whichever comes later | `judge_after_days` (60), `judge_after_paying_teachers` (30) | Stripe |
| Keep both plans if | monthly is at least 20% of new paying teachers AND at least half of monthly teachers still pay after 3 months | `keep_monthly_min_share` (0.20), `keep_monthly_min_retention_3mo` (0.50) | Stripe |
| Drop monthly if | monthly is under 20% of new paying teachers, OR most monthly teachers cancel within 2 months | `drop_monthly_max_share` (0.20), `drop_monthly_cancel_2mo` (0.50) | Stripe |
| Revisit the $29 price if | fewer than 2 in 100 signed-in teachers who see the subscribe card start a checkout | `revisit_price_min_checkout_rate` (0.02) | PostHog `subscribe_card_shown` then `checkout_started` |

## Architecture

| Piece | Where | What it does |
|---|---|---|
| **avery-hub** | private repo `joydai2026-del/avery-hub` from S0d (today `avery-hub/` in little-games) | sign-in, sessions, D1, Stripe, webhooks, reconciliation, the paid gate, downloads, requests, admin |
| **HubService** | `src/rpc/hub-service.ts` | the only way a game reaches teacher data or the gate (named `WorkerEntrypoint` over a service binding, A, developers.cloudflare.com/workers/runtime-apis/rpc/) |
| **TokenDO** | hub | burns hand-off tokens, OAuth state and pending sign-ins exactly once |
| **BillingDO** | hub (stub today) | one per Stripe customer: that customer's events and checkouts, one at a time |
| **D1**, **R2 `avery-packs`** (private, no public URL) | bound to the hub only | teacher data; pack PDFs and delivered request packs |
| **Six game Workers** | vocab repo `joydai2026-del/bilingual-vocab-game`; five in little-games | each grants its own one anonymous round and asks HubService for every other round |
| **Room Durable Object** | each room game | the room, its pass, the 1-hour ranking |
| **Legal page** | `https://www.averystudio.org/legal/policies` | terms, privacy, children, refunds |

Caption Wars is not an Avery game (not in `GAME_REGISTRY`, A) and is not gated. Why the hub moves to a private repo (S0d): little-games is **PUBLIC** (A, `gh repo view`, 2026-09-29), and the hub's ops receipts (the filled Stripe webhook inventory, the tax receipt the setup script requires, A), alert and request issues, migrations and review trail do not belong in public. Games reach the hub only by service-binding name, so no code link breaks. Hub code pushed to public little-games branches before the split stays in public git history; it contained no secrets (secrets live only in Cloudflare).

### The internal API is RPC only

Built in S1: the hub's `fetch` serves only `/auth/*`, `/me`, `/me/*`, `/billing/*` and `/stripe/webhook` (both answer 501 until S2b), `/admin/*`; **`/downloads/*` is NOT built** (S6 adds it); `/internal/*`, `/rpc`, `/HubService` and every method name return 404. `/admin/*` sits behind Cloudflare Access and the hub verifies the Access token itself (fail closed when unset), on every hostname including staging preview hosts. Every method takes `{ gameId, gameKey }`; each `HUB_GAME_KEY` is 32 random bytes and only its hash sits in `GAME_REGISTRY` (with return URLs, allowed methods, modes). A session or pass minted for game Y is refused when game X presents it.

| Method | Purpose | Needs |
|---|---|---|
| `redeemHandoff(caller, token, bindingValue)` | one-time token to game session; ends the previous session of the same game and hub session | token bound to this game and browser |
| `resolveSession`, `signOut` | who is this; end this device's hub session and all its game sessions | game session |
| `entitlement(caller, gs)` | screen only: `{ plan, accessUntil }` today; S2b adds `interval: "yearly" \| "monthly" \| "grant"` | game session |
| `authorizeRound(caller, gs, mode, roomCode or null)` | one paid round grant (below); anonymous rounds never reach the hub | game session, paid |
| `listLists / getList / saveList / deleteList`, `listClasses / saveClass / deleteClass` | paid only; the paid check is inside each statement (built) | game session, paid |
| `mintRoomPass`, `checkRoomPass` | pass for a paid teacher's room (one conditional insert, built); any `valid: false` means stop paid rounds | game session / pass of this game |
| `useTaste`, `switchFreeMode` | refused while `FREE_TIER_ENABLED` is `false` (built); removed from every game's `methods` list | none |

### Round grants (paid)

A grant is one-time, expires after `ROUND_GRANT_MINUTES` (10), and is bound to the game, the mode and (where one exists) the room code. In a room, the grant is written to the Room DO and consumed there, one at a time. For single-screen modes the grant is consumed in the same response that returns the round's content (server-built questions, the sheet, the solo list), so there is nothing to replay. Any round-start route not in the six-game table below fails closed; a test calls every other `/api/*` POST route with a round-like body and asserts no round starts.

### One token protocol (built in S1; unchanged rules)

| Piece | Rule |
|---|---|
| Binding cookie | `__Host-avery_bind` (32 random bytes, 10 minutes); only its SHA-256 goes to `hub/auth/start`. Login-CSRF defence. |
| Hand-off token | 32 random bytes in the URL fragment; stored only as an HMAC with key version in a TokenDO; burned first, then checked (game, bind, 60 s expiry); a missing key returns `unavailable`. OAuth state and device-picker values carry their key version. |
| Game session | minted and stored by the hub; cookie `__Host-avery_game` holds only the id; **one live game session per game per hub session** (row 14). |
| Revocation | ending a hub session ends its game sessions; sign out everywhere, device limit, admin revoke and delete act in the hub; a token minted before "sign out everywhere" cannot be redeemed after it. |
| Lifetimes | hub idle 30 days, absolute 90, rotated every 7 with a 30 s overlap; game session absolute 12 hours, idle 4. |
| CSRF | POST only, `Origin` allowlist, SameSite=Lax, per-session CSRF token; hub pages send `Referrer-Policy: same-origin` so browsers keep the Origin on form posts. |
| Rate limits | bind hash and game id plus an address bucket held only in the limiter's memory, never stored; separate namespace ids per environment. |
| Key rotation | overlapping `SESSION_HASH_KEY_V1/V2`, `SESSION_HASH_KEY_CURRENT`; the version travels in every value. |

Sign-in: Google server flow with `state`, `nonce`, `openid email profile`, `prompt=select_account` (A, developers.google.com/identity/openid-connect/openid-connect); teacher found by Google `sub`; device limit `MAX_TEACHER_DEVICES` (3) with a picker; "Signed in as x@school.org" on teacher screens, the subscribe card and before checkout.

### Google environments

| Item | Staging | Production |
|---|---|---|
| Hub | `https://avery-hub-staging.joyd-ai-2026.workers.dev` | `https://hub.averystudio.org` |
| Callback URIs | `.../auth/callback` on staging, `http://localhost:8787/auth/callback` | `https://hub.averystudio.org/auth/callback` only |
| Consent screen | Testing, 100 listed users (B) | Published by JJ in S5; needs the legal page and the verified domain; brand review can take days (B) |
| Game return URLs | staging games (localhost return URLs move to a `dev` env) | the six `*.averystudio.org/auth/finish` URLs (A) |

### When the hub is down or broken

Rule: anything that saves or spends fails closed; a paid teacher keeps playing on her cached entitlement (D4) and her room keeps its pass (D3).

| Moment | What the teacher sees | What the system does |
|---|---|---|
| Sign-in or hand-off | "Can't sign in right now. Please try again in a few minutes." | no game session is made |
| Her one free round | nothing changes | the game Worker grants it alone |
| Paid round, cache fresh | nothing changes | the game grants from its cached paid answer (D4) |
| Paid round, no fresh cache | "We can't check your subscription right now. Please try again in a minute." | refused |
| Room with a paid pass | nothing changes | rounds allowed until the pass expires (room lifetime + 15 min, D3) |
| Pass re-check at round start | nothing changes, or the subscribe card if revoked | hub answers `valid: false`: paid rounds stop; hub silent: the stored pass decides |
| Saving a list | "Can't reach your lists right now. Your list is still here; try again in a minute." | draft stays in session storage |
| Checkout return | "We're confirming your payment; it can take a minute." | the checkout code stays valid 60 minutes; reconciliation finishes it |
| Download | "Can't get that file right now. Please try again in a minute." | nothing is served, nothing counted |

**Entitlement cache (D4, HOW, C):** after each successful `entitlement` or `authorizeRound`, the game sets `__Host-avery_ent`: `{ gameSessionHash, paid, until, issuedAt }` signed with a game-local HMAC key. It is read only when the hub is unreachable, and only if `issuedAt` is within `ENTITLEMENT_CACHE_HOURS` and `until` is in the future. No server storage.

**Room pass:** pass id, game id, room code, teacher id, allowed modes, entitlement version, issued, expires. Stored in the Room DO, never sent to a device. It is short-lived operational data (it holds a teacher id and a room code) and is deleted by the expiry clean-up. Expiry is per game: `ROOM_PASS_MINUTES` = that game's room lifetime + 15 (config per game; vocab rooms live 2 hours, A, `room-do.ts` line 70; the five little-games rooms extend their life on every round (A, S1 review), so while the hub answers, a `valid` answer re-mints the pass). A refund, dispute, cancel-now, admin revoke, delete or move bumps `entitlement_version`, and `checkRoomPass` answers `revoked`.

Tests: each row with a throwing HubService binding; a refund during a hub outage ends play at pass expiry or cache expiry, whichever comes first.

## Data model and per-teacher isolation

`0001_init.sql` and `0002_rotation_overlap.sql` are built (A). Version 3 adds **`0003_v3.sql`** (additive only).

| Table | Built | v3 change |
|---|---|---|
| `teachers` | id, google_sub (nullable only for a tombstone), stripe_customer_id, analytics_id, email, display_name, entitlement_version, manual_access_until, timestamps; `free_game`, `free_game_locked_until`, `taste_day`, `taste_used` | the four free-tier columns are **deprecated**: kept, unused while `FREE_TIER_ENABLED` is `false`, dropped by a later migration after one release with no reader; never a destructive migration in the same release |
| `sessions`, `game_sessions`, `lists`, `classes`, `round_history`, `room_passes`, `stripe_events`, `billing_ops`, `checkout_codes`, `seat_grants`, `admin_log` | as built | none |
| `subscriptions` | as built | add `plan_interval` (`year`, `month`); teacher intent is read from Stripe's `cancellation_details.reason`, not stored in a second column |
| `requests` (new) | none | `id`, `teacher_id` (CASCADE), `text` (plain text, control characters rejected, max `REQUEST_MAX_CHARS`), `status` (`new`, `in_progress`, `delivered`, `declined`), `r2_key`, `issue_number`, `created_at`, `delivered_at` |
| `pack_downloads` (new) | none | `id`, `teacher_id` (CASCADE), `pack_id`, `pack_sha256`, `at`; one row per **successful** download |
| `reconcile_cursor` (new) | none | durable cursor for refunds and disputes (below) |

Deleting a teacher is a tombstone: only `id`, `stripe_customer_id`, `deleted_at` remain; her lists, classes, history, sessions, requests (and their R2 files) and download log are deleted; an attached seat grant's email is hashed. Billing rows stay for tax. No kid data is stored in D1.

**Isolation rule (built):** all SQL in `src/db/`; teacher data only through `forTeacher(db, teacherId)`; `teacherId` only from a session the hub resolved; admin code only under `/admin/*`; the paid predicate inside the same statement as every paid read or write; typed errors at the RPC boundary. Batches are transactions (A, developers.cloudflare.com/d1/worker-api/d1-database/).

| Atomic rule | One statement or one batch |
|---|---|
| Room pass | conditional insert with paid predicate and expected entitlement version (built) |
| Saved list | insert only under the paid predicate (built) |
| Request, 1 per calendar month (UTC) | insert under the yearly predicate and the month count |
| Download | after a successful stamp: insert under the yearly predicate and the UTC-day count; the file is sent only if 1 row changed |
| Webhook effect | serialized in BillingDO; state write and "processed" mark in one batch |

Isolation tests run on every deploy (built for S1 tables and methods). S6 adds: A cannot download under B's email, A cannot read B's requests or delivered files, a stamped PDF carries only the downloader's email.

## The gate (every game, server-side)

A round starts only with **(a)** the anonymous free round or **(b)** a paid grant.

| | (a) Anonymous free round | (b) Paid |
|---|---|---|
| Who | anyone, no sign-in | signed-in teacher with paid access (subscription, seat grant, manual grant) |
| How many | `ANON_FREE_ROUNDS_PER_GAME` (1) per game per browser (D1) | unlimited |
| Who decides | the game Worker alone (works with the hub down) | the hub (`authorizeRound`, a room pass) or the entitlement cache (D4) |
| Proof | `__Host-avery_taste_<gameId>` (Secure, HttpOnly, SameSite=Lax, `Path=/`, 400 days), set **on the same response that returns the grant** | one-time round grant |
| Next time | cookie present: "Sign in and subscribe to keep playing" | n/a |

`TRIAL_DAYS` (0) stays in config; `ANON_FREE_ROUNDS_PER_GAME` at 0 removes the free round. Nothing about an anonymous visitor is stored on our servers.

### Rooms (D12)

| Moment | Teacher's screen | Kids' tablets |
|---|---|---|
| Anonymous room creation, cookie absent | lobby; the cookie is set on this response; the room gets an anonymous pass allowing exactly 1 round, counted in the Room DO | normal join |
| Anonymous room creation, cookie present | the subscribe card; no room is made, so no kid ever joins a dead room | none |
| After the anonymous room's one round | the subscribe card | "Round over, ask your teacher" |
| Paid room | every mode, every round, on the room pass | as today |
| Pass revoked or expired mid-lesson | the running round finishes; the next start shows the subscribe card | "Round over, ask your teacher" |

Kid screens never show a price, "subscribe" or a sign-in button (a test opens every kid route and asserts it). A kid's player id can never start a round beyond the pass (vocab lets a player id start a round today, A, `src/worker/index.ts` line 16).

### Per-game integration steps (the same for every game)

1. **Binding:** service binding `HUB` to `avery-hub` with `"entrypoint": "HubService"` (staging binds `avery-hub-staging`); vars `GAME_ID`, `ANON_FREE_ROUNDS_PER_GAME`, `ROOM_PASS_MINUTES`, `ROUND_GRANT_MINUTES`, `ENTITLEMENT_CACHE_HOURS`, `NICKNAME_MAX_CHARS`; secrets `HUB_GAME_KEY` (32 random bytes) and the cache HMAC key. Key hashes go to the hub's `GAME_REGISTRY` through the hub's shared-files owner (below).
2. **Hand-off:** `GET /auth/finish`, `POST /api/auth/redeem`, `POST /api/auth/signout`, `GET /api/me` (teacher screens only).
3. **`POST /api/round/start {mode}`** for single-screen and browser-run modes: game cookie and paid (hub or fresh cache) gives a grant; else taste cookie present gives the subscribe message; else grant the free round and set the cookie on this response.
4. **Rooms:** `POST /api/rooms` checks paid first (`mintRoomPass`), then the taste cookie (D12). Every round start inside the room checks only the pass (and `checkRoomPass` when the hub answers).
5. **Screens:** teacher screens only: sign-in, "Signed in as", the subscribe card ($29 a year or $4.99 a month; "renews automatically, cancel any time"; "printable packs and requests are yearly only"; "Billed by Ownly Network LLC as AVERY STUDIO"; the renewal terms shown on our plan page before the Stripe redirect).
6. **Kids' privacy (legal checklist):** the join screen gets a labelled "Privacy" link to `#children` on the legal page (operator name, address, email; address is JJ's placeholder); nicknames are one word, no spaces, at most `NICKNAME_MAX_CHARS` (12), with the hint "a nickname, not your real name"; each game Worker sets `observability.enabled: false` (no Workers Logs, B) and no code logs or stores `CF-Connecting-IP`. **Choice: logs off, not IP stripping**, because Workers Logs record request metadata we cannot filter per route (C), and the games need no logs to run.
7. **Tests per game:** free round granted and cookie on the same response; second refused; anonymous room creation refused when the cookie is present; Dictation Dash solo plays its one round; paid session granted; grant replay refused; hub throwing (free round works, paid round uses the cache, room with a pass continues); kid id cannot start past the pass; unrecognised round routes fail closed; no IP in any log or storage.

### The six games

Read in each game's `src/` at little-games `441b022` and the vocab repo `main` at `77e490f` (A unless marked).

| Game (`GAME_ID`) | Repo | Worker | Round-start routes to gate | Room path | Notes |
|---|---|---|---|---|---|
| Vocab (`vocab`) | `bilingual-vocab-game` | `bilingual-vocab-game` | new `/api/round/start` for single-screen modes (memory, reveal, sky-tower, tone, listen, echo, whack run in the browser); `POST /api/rooms/:code/round` (race, climb, dash, tower) and the legacy `/start` alias | `POST /api/rooms` (both body shapes); `src/worker/room-do.ts` | `ROOM_TTL_MS` hard-coded at line 70, moves to config; custom-domain branch `feat/custom-domain` state to confirm in S2c (C) |
| Tianzige (`tianzige`) | little-games `tianzige-generator/` | `tianzige-generator` | new `/api/round/start` (mode `main`) before preview and Print are enabled (renders in the browser, `src/client/main.ts`); `POST /api/sheet` (agent path) needs a grant | none (no `room-do.ts`) | one round = one sheet |
| Trace Race (`trace-race`) | `trace-race/` | `trace-race` | `/api/rooms/:code/start`, `/next` | `POST /api/rooms`; `room-do.ts` | no solo path found (grep, B) |
| Stroke Reveal (`stroke-reveal`) | `stroke-reveal/` | `stroke-reveal` | `/start`, `/next` | `POST /api/rooms`; `room-do.ts` | no solo path found (grep, B) |
| Missing Stroke (`missing-stroke`) | `missing-stroke/` | `missing-stroke` | `/start`, `/next`; new `/api/round/start` before `#/solo` (runs on the phone, `src/client/solo.ts`) | `POST /api/rooms`; `room-do.ts` | |
| Dictation Dash (`dictation-dash`) | `dictation-dash/` | `dictation-dash` | `/start`, `/next`; solo is a room with `mode: "solo"` (`src/client/api.ts` line 88), gated at creation (D12) | `POST /api/rooms`; `room-do.ts` | speech budget unchanged |

**Agent-native:** an agent joins any room through the same HTTP API as a kid, ungated. An HTTP client without a cookie jar gets a free round on every request (the accepted limit in D1); a paid agent path (teacher-issued API key) stays a follow-up.

## Stripe

### Objects (setup script built in S2a)

| Object | Value | Config key |
|---|---|---|
| Product | "Avery Classroom Games", `statement_descriptor` `AVERY STUDIO`, metadata `app=avery` | `STRIPE_PRODUCT_ID` |
| Price, yearly | **$29.00 USD a year, lookup key `avery_yearly_v2`** | `STRIPE_PRICE_YEARLY` |
| Price, monthly | **$4.99 USD a month, lookup key `avery_monthly_v2`** | `STRIPE_PRICE_MONTHLY` |
| Webhook endpoint | the 11 events below, API version pinned | `STRIPE_WEBHOOK_SECRET` |
| Portal | cancel at period end, update card, invoice history; plan switch and cancel-now off | `STRIPE_PORTAL_CONFIG_ID` |

**v1 prices:** never created in live mode, so no live v1 subscription can exist. In staging test mode any v1 objects are archived (`active: false`), never deleted, and any v1 test subscriptions are cancelled by the setup run and listed in its readback. Reconciliation lists subscriptions **by product**, not by price, so every price generation is covered. Amounts and lookup keys are config. The setup script refuses the wrong key mode, needs `--live --i-have-read-the-tax-gate` for live, and requires the webhook inventory and tax receipts, which live only in the private hub repo (S0d).

**Branding (unchanged, A, Stripe product, statement-descriptor and Checkout docs, read 2026-09-28):** the statement says `AVERY STUDIO` (banks vary); Checkout's top says "Avery Studio"; receipts, portal and Checkout terms say Ownly Network LLC with the line item "Avery Classroom Games".

### Customer mapping and no double purchase

One Stripe customer per teacher (`metadata.teacher_id`, idempotency key `customer:<teacher_id>`). `/billing/checkout` runs inside her BillingDO and, before creating a session, **lists her subscriptions from Stripe itself** (not local state): any subscription that is not `canceled` or `incomplete_expired` sends her to the portal. It expires any other open Checkout Session for her and reuses one unexpired session. Every mutating call carries an idempotency key (built).

### Webhook processing (serialized per customer)

Events: `checkout.session.completed`, `customer.subscription.created/.updated/.deleted/.paused/.resumed`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.

1. Verify the signature on the raw body (built). Failure is 401.
2. Resolve the customer (subscription, invoice, checkout: `customer`; refund: the charge's customer; dispute: the dispute's charge). Not a known teacher: `not_avery`, 200.
3. `INSERT OR IGNORE` the event as `received`; already `processed`: 200.
4. `enqueue(eventId)` on that customer's BillingDO, written to its durable storage with an alarm before returning; only then 200.
5. The DO processes one event at a time: fetch the subscription, the last paid invoice's period end, the latest charge, refund ops, and **every dispute on any charge of this subscription** (each resolved charge to invoice to subscription; a dispute it cannot resolve counts against her). It passes `accessFor` the most severe one (lost, then open, then unresolvable, then won or prevented), so a won dispute never clears another open one. Then it writes the subscription row, bumps `entitlement_version` if access dropped, and marks the event processed, in one batch.
6. Errors: stays queued, backoff from 30 s to 1 hour; the hourly cron re-enqueues D1 rows still `received` or `failed`.
7. Three failed attempts: alert.

### State model: `accessFor` (matches the S2a code, `src/stripe/access.ts` at `a3e29d1`, A)

`accessFor(subscription, latestCharge, dispute, refundOps, now, policy, lastPaidPeriodEnd)` returns `{ plan, until, reason }`. Policy values are validated with maxima (grace days at most 30, trial days at most 90).

| Input state | Access |
|---|---|
| a lost dispute on any charge of this subscription, or an unresolvable dispute | none (lost also cancels the subscription) |
| an open dispute on any charge of this subscription | none while open (`DISPUTE_ACTION` pause) |
| dispute won or prevented | back to the subscription's state |
| unknown dispute status | none, with an alert |
| latest paid charge fully refunded, or a completed refund op | none, at once (D3) |
| partial refund | no change |
| `trialing` | until `trial_end` (D8) |
| `active` with `pause_collection` | until the last PAID period end, no grace (D6) |
| `active`, current period not yet proven paid | last paid period end + `PAST_DUE_GRACE_DAYS` (D7); none if no period was ever paid |
| `active` (renewing or cancelling at period end), current period paid | period end + `ACCESS_END_GRACE_DAYS` (D5) |
| `past_due` | start of the unpaid period + `PAST_DUE_GRACE_DAYS` (D7) |
| `canceled`, teacher asked (`cancellation_requested`) and `ended_at >= current_period_end` | min(period end, last paid period end) + 7 days (D5) |
| `canceled`, any other way (refund, lost dispute, deletion, failed payments) | none |
| `incomplete`, `incomplete_expired`, `unpaid`, `paused` | none |

**Refunds are never re-granted:** the refund-then-cancel workflow (refund, cancel now without proration, mark `refunded_full`, bump the version), each step in `billing_ops`, safe to re-run; a Dashboard refund triggers steps 2 and 3; reconciliation never clears a refund or an open dispute from a subscription fetch alone. Runbooks `docs/ops/refund.md`, `dispute.md` (built).

### Reconciliation (daily, `RECONCILE_HOUR_UTC`)

Lists every subscription **of the Avery product** (all statuses), maps by `metadata.teacher_id`; reads refunds and disputes since the durable `reconcile_cursor` (with a one-day overlap), not a fixed 35-day window, so an event missed during a long webhook failure is still found; runs each customer through its BillingDO; alerts on any fix, two live subscriptions, an unknown Avery subscription, a still-billing tombstone, or a missed run.

### Alerts and requests go to the private hub repo

Issues in `joydai2026-del/avery-hub` (private, S0d), labels `avery-alert` (`avery-alert-staging`) and `avery-request`, opened with a token that can only write issues there. Issue bodies carry ids only (never an email, name or request text). `ALERT_CHANNEL`, `ALERT_GITHUB_REPO` are config. Before any live endpoint is added, a read-only inventory of every webhook on the Ownly account is written to the private repo; live endpoints subscribed to charge or subscription events must ignore `app=avery` objects.

### Refunds, receipts, price changes

- Yearly: full refund within `REFUND_WINDOW_DAYS` (14) of the first purchase and each renewal; access ends at once (D3). Monthly: cancel any time, no refund, access to period end plus grace when she asked (D5).
- **Price increase (legal checklist, NY GBL 527-a(1)(b-1)):** notice 14 to 30 days before the new price (`PRICE_CHANGE_NOTICE_DAYS` window); a monthly teacher may cancel within 14 days after the first higher charge and gets a pro-rata refund of the unused part (D13; the admin refund tool takes a pro-rata amount; runbook step). Yearly renewals are already covered by the 14-day refund.
- Stripe keeps processing fees on refunds (A, docs.stripe.com/refunds); about $1.14 per $29 refund (C). S5 records the real fee lines.
- Receipts and Stripe's built-in upcoming-renewal email are turned on (B); automatic delivery is proven on the first live purchase.

### Tax gate before live mode

Stripe Tax collects only where registrations exist; the business decides where it owes tax (A, docs.stripe.com/tax/registering). JJ and her accountant confirm the home state, taxability (packs may be treated differently from a software service, C), the product tax code and registrations. The receipt lives in the private hub repo.

### Secrets and config

Secrets (separate staging and production values): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOOGLE_CLIENT_SECRET`, `SESSION_HASH_KEY_V1/V2`, `HUB_GAME_KEY` (each game; hub stores the hash), each game's entitlement-cache HMAC key, `ALERT_GITHUB_TOKEN`, `CF_ACCESS_SERVICE_TOKEN` (admin CLI only).

| Config var | State | Default |
|---|---|---|
| `ANON_FREE_ROUNDS_PER_GAME`, `ROUND_GRANT_MINUTES`, `ENTITLEMENT_CACHE_HOURS`, `ROOM_PASS_MINUTES` (per game), `NICKNAME_MAX_CHARS` | new (games; hub reads the first for screens) | 1, 10, 24, room lifetime + 15, 12 |
| `TRIAL_DAYS`, `ACCESS_END_GRACE_DAYS`, `PAST_DUE_GRACE_DAYS`, `DISPUTE_ACTION`, `REFUND_WINDOW_DAYS` | kept (S2a, validated with maxima) | 0, 7, 7, pause, 14 |
| `GRANT_COUNTS_AS`, `REQUESTS_PER_MONTH`, `REQUEST_MAX_CHARS`, `REQUEST_RETENTION_MONTHS`, `DOWNLOADS_PER_DAY`, `PACK_FOOTER_TEMPLATE`, `PRICE_CHANGE_NOTICE_DAYS` | new | yearly, 1, 1000, 12, 20, "Licensed to {email}, {date}. One classroom only; please do not share.", 14-30 |
| `DB_READY`, `SESSION_ROTATE_OVERLAP_SECONDS`, `AUTH_ADDRESS_LIMITER` (binding) | built in S1 fix round 1 (A) | false in production until migrated, 30 |
| `ROOM_PASS_HOURS` | built (flat 4); **replaced** by per-game `ROOM_PASS_MINUTES` in S2b | removed |
| `FREE_TIER_ENABLED` and the free-tier vars (`FREE_LIST_LIMIT`, `FREE_TASTE_ROUNDS_PER_DAY`, `FREE_MODE_SWITCH_COOLDOWN_DAYS`, `FREE_GAME_COUNT`, `FREE_GAME_CHOICES`, `ANON_FREE_ROUNDS`) | **deprecated** (built, A). `FREE_TIER_ENABLED` stays `false`; the rest are unread while it is false and are removed in the same later release that drops the four columns | false |

Also config: `GOOGLE_CLIENT_ID`, `POSTHOG_PROJECT_KEY`, price ids, portal id, `GAME_REGISTRY`, `PACKS`, `SESSION_HASH_KEY_CURRENT`, `ALERT_CHANNEL`, `ALERT_GITHUB_REPO`, `STRIPE_MODE`, `SUPPORT_EMAIL`.

## Materials (yearly members)

| Item | Plan | Delivery |
|---|---|---|
| Tianzige Generator, writing-pack engine | both plans | the Tianzige game (gated) |
| Printable packs | **yearly only** (and grants, D9) | hub `/downloads`, stamped (D11) |
| "Tell us what you need" | **yearly only**, 1 a calendar month (UTC) | hub `/me/requests`, filled by hand, delivered as a download |

### Packs config and licence receipt

`config/packs.json`, validated at deploy: `id`, `title`, `r2Key`, `version`, `sha256` of the exact file, `licenceLine`, and **`licence_checked: { date, by, sha256 }`**. A pack is visible only when `licence_checked.sha256` equals the file's `sha256`, so replacing a file hides the pack until it is checked again. The deploy test also checks each R2 object exists, starts with `%PDF-`, is under a size limit and has a page count (C: size limit set in S6).

Also `creator_id` (default `owner`), for the follow-up creator marketplace; nothing reads it until then.

### Downloads route

`GET /downloads` lists visible packs and her delivered request files (yearly or grant; others see the subscribe card). `POST /downloads/<id>` (Origin and CSRF checked): yearly check and a read of today's count, read from R2, stamp the footer with her sign-in email and the UTC date (D11), then the conditional `pack_downloads` insert; only then the file is sent with a sanitized ASCII filename (RFC 6266 `filename*` for the rest), `Content-Disposition: attachment`, `Cache-Control: private, no-store`. **A failed read or stamp is not counted** and sends an alert. No stamped copy is cached. As D11 says: a non-ASCII domain prints in punycode, and a non-ASCII local part falls back to her short teacher id ("Licensed to teacher #<short id>, <date>").

**Stamping HOW (C):** A) `pdf-lib` with the built-in Helvetica, one line per page: pure JavaScript, a few lines of our code; a new dependency, so the two-round repo safety scan runs first, and the scan notes its release age. B) a hand-written PDF incremental update: no dependency, fragile with compressed object streams. **Preference: A**, B only if the scan fails (packs then exported without object streams). CPU is measured on the biggest pack in S6. Each page size in each pack is opened and looked at once (render gate).

### Request button

Yearly teachers post a short plain-text form to `POST /me/requests` (control characters rejected; the insert enforces yearly access and the monthly count). The hub opens an `avery-request` issue in the private hub repo carrying **the request id only**. JJ reads the text at `/admin/requests`; request text is only ever rendered HTML-escaped, admin and account pages carry the strict no-inline-script CSP (built), and the text never goes into logs, issue bodies, commands or any agent prompt as instructions. A test stores `<script>` and an "ignore previous instructions" string and asserts both render escaped.

**Delivery:** JJ uploads the finished pack to the private bucket at `requests/<teacher_id>/<request_id>.pdf`, marks the request `delivered` (allowed only when that object exists), and the teacher sees it under "My downloads", served by the same stamped route (not counted against the pack cap). Requests and their files are deleted `REQUEST_RETENTION_MONTHS` (12) after delivery or decline, and with her account. No AI generation in this plan.

### Pilot rules (60 days, `config/materials-pilot.json`)

| Rule | Threshold | Config key | Data source |
|---|---|---|---|
| Length | 60 days from go-live | `pilot_days` | clock |
| Keep going if | at least 3 signed-in teachers subscribe to yearly (including Dashboard monthly-to-yearly upgrades) within 14 days of seeing the request offer, AND at least 10 member requests | `min_subscribes_after_offer` (3), `offer_window_days` (14), `min_member_requests` (10) | PostHog `request_offer_shown`, hub subscriptions, `requests` |
| Stop early | after 20 delivered packs | `max_hand_made_packs` (20) | `requests` |

## Rankings (unchanged)

The 1-hour board: nickname (one word, 12 characters) plus a **room-only participant id** in session storage under the room code, cleared when the room ends, expires or resets; only in the Room DO; cumulative points across rounds in paid rooms (an anonymous room has one round); ids never sent to tablets; `RANKING_KEEP_MINUTES` (60). Never stored: real names on purpose, email, photo, voice, IP address, location, device details. **Long-term class ranking BLOCKED** until a lawyer-reviewed school and parent notice, consent path, retention limit, reset and deletion exist (A, FTC COPPA FAQ sections A, J, N).

## Analytics (teacher screens only)

Settings unchanged (joydong.org's PostHog setup: memory persistence, no IP, no geoip, fragments stripped, no recording, no autocapture); `analytics_id` only; shut down on any kid route; money events sent by the hub after Stripe confirms. Anonymous teacher screens load without an id.

Events: `teacher_signed_in`, `free_round_used`, `paywall_shown`, `subscribe_card_shown`, `checkout_started`, `subscription_changed` (hub), `round_started`, `list_saved` (hub), `request_offer_shown`, `request_sent` (hub, never the text), `pack_downloaded` (hub). Retired: `free_list_replaced`, `free_mode_switched`, `switch_blocked_cooldown`, `taste_round_played`, `upgrade_card_shown`.

## Teacher data lifecycle

| Item | Rule |
|---|---|
| Email change, two accounts, lost school account | as built: `sub` is identity; `moveTeacher` by JJ after a receipt check |
| Export | lists, classes, history, subscription summary, seat grants, requests |
| Delete my account | typed DELETE; cancels any subscription at once; deletes lists, classes, history, sessions, requests and their files, download log; tombstone |
| After paid access ends | lists and classes hidden 90 days (`KEEP_AFTER_END_DAYS`), then deleted; subscribing again brings them back |
| Never paid or stopped | deleted after 400 days without sign-in (`INACTIVE_DELETE_DAYS`); never with a live subscription or seat |
| Expired rows | a daily cron removes expired sessions, game sessions, room passes |

School invoices and purchase orders: unchanged (email `hello@averystudio.org`, W-9, net-30 Stripe invoice, `grantSeats`; runbook `docs/ops/school-po.md`).

## Legal page and house rule

House-rule reword: little-games PR #24 merges before the hub. The legal page (joydong.org PR #88) is referenced, not restated. **S0c** updates it: one free round per game per **browser**, then subscribe; $29 and $4.99; packs and requests yearly only, packs licensed to one teacher and stamped with her email and the date; lists hidden 90 days after access ends; request text kept until 12 months after delivery or account deletion; the price-change notice (14 to 30 days) and the monthly 14-day pro-rata cancel after a higher charge; the children's notice: servers see a device's internet address only to deliver and protect the game, never to identify, contact or profile a child, and the games do not log it; "the only things a game saves about a child" wording; operator name, address (placeholder), email, and a phone number or the lawyer's OK.

## Environments and release operations

| Item | Staging | Production |
|---|---|---|
| Hub Worker, D1 | `avery-hub-staging`, `avery_hub_staging` (A) | `avery-hub`, `avery_hub` (not created; a placeholder id makes a production deploy fail safe, A) |
| R2 | `avery-packs-staging` | `avery-packs` |
| Stripe | test mode | test until S5, live from S5 |
| Rate-limit namespaces | own ids | own ids |
| PostHog | off or staging project | production project |
| Alerts | private hub repo, `avery-alert-staging` | private hub repo, `avery-alert` |

Migrations numbered and additive, applied before the code that needs them; `wrangler rollback` (B); D1 Time Travel restore rehearsed once on staging (not yet done) plus a weekly private export; key rotation steps in `docs/ops/rotation.md` (built); admin `grantAccess` and `revokeAccess` (built); support `hello@averystudio.org`.

## Remaining slices

Assumptions: at most **3 parallel builders** and **1 review panel at a time**. Review tiers: **full** = three Claude lenses plus Codex, no round cap (money, auth, production writes, customer or kid data); **default** = one Claude reviewer plus Codex. Every full-panel slice budgets at least **1 fix-round day**. Estimates are judgement (C).

**Shared files owner:** in the hub, `src/index.ts`, `src/env.ts`, `wrangler.jsonc` (including `GAME_REGISTRY` key hashes and the R2 binding), `package.json` and the lock file belong to **the hub slice of the moment** (S1-fix, then S0d, then S2b, then S6); other slices hand their edits to that owner as merge notes. In each game, `package.json`, the lock file, `tsconfig.json`, the Vite config and `wrangler.jsonc` belong to that game's builder only; the shared `avery-gate/` builder never touches them. The vocab app cannot import `avery-gate/` (another repo), so S2c builds a copy and one contract test suite runs against both.

| Slice | Work | Build | Review (tier) | Fix | Total | Parallel with | Depends on | Files it owns |
|---|---|---|---|---|---|---|---|---|
| **S1-fix** | round-2 full panel on `85901f9` and its fixes; `0003_v3.sql`; localhost return URLs to a `dev` env; expired-row cron; Time Travel rehearsal | 0.5 | 0.5 (full) | 1 | 2 | S2a-fix, S0c | nothing | hub `src/{db,rpc,auth,admin,routes,pages}`, migrations, hub shared files |
| **S2a-fix** | fix round 3 (round 2's dispute, paused-collection, charge-id and `prevented` fixes are committed at `a3e29d1`); v2 prices and lookup keys; v1 archive and test-subscription cancel; `interval` output | 0.5 | 0.5 (full) | 1 | 2 | S1-fix, S0c | JJ test key (can finish on fakes) | hub `src/stripe/`, `scripts/stripe-setup.ts`, `docs/ops/*`, `tests/stripe/` |
| **S0c** | legal page changes above | 1 | 0.5 (default, 2 rounds max) | 0 | 1.5 | S1-fix, S2a-fix | JJ wording approval | joydong.org `legal/policies.html` |
| **S0d** | `git subtree split` of `avery-hub/` into private `joydai2026-del/avery-hub` with full history, then `avery-hub/` is removed from little-games with NO archive copy left in the public repo: the private repo with full history IS the archive (house rule "archive, never delete" satisfied); CI and deploy from the new repo; ops receipts and issues live there | 0.5 | 0.5 (default) | 0 | 1 | none | S1-fix, S2a-fix merged | the new repo; removal of `avery-hub/` from little-games |
| **S2b** | Checkout (Stripe-list check, open-session expiry, auto-renew and yearly-only text, plan page terms), BillingDO webhooks, per-charge dispute resolution, reconciliation by product with cursor, alerts, refund tools (including pro-rata), `authorizeRound` with one-time grants, per-game `ROOM_PASS_MINUTES`, `interval` in `entitlement`, seat grants, hub-down tests, full test-mode run | 4.5 | 1.5 (full) | 1 | 7 | S0c | S0d | hub `src/billing/`, `src/do/billing-do.ts`, `src/rpc/` gate methods, hub shared files |
| **S2c** | the seven integration steps in the vocab app; server-built questions; both room paths; `ROOM_TTL_MS` to config; nickname filter; logs off; custom-domain branch confirmed; contract tests | 2.5 | 1 (full) | 1 | 4.5 | S2d, S6 | S2b | vocab `src/worker/*`, `src/client/*`, `wrangler.jsonc`, `package.json` |
| **S2d** | (1) `avery-gate/` shared module and contract tests, one builder, contract reviewed (default panel) before branching; (2) five game builders, one per game, **each game's change gets the default panel (one Claude reviewer plus Codex) before it merges**; (3) one integration commit and a six-game bypass suite on the merged SHA, which gets the **full panel** | 1 + 5 + 0.5 | 2.75 (0.5 contract default, 5 x 0.25 per-game default, 1 merged full) | 1 | 10.25 | S2c, S6 | S2b | `avery-gate/` (step 1); `<game>/` of its own game (step 2); integration owner (step 3) |
| **S6** | R2, `packs.json` with licence receipts and validation, `/downloads` with stamping after the safety scan, request form, delivery, `/admin/requests`, retention cron, pilot report rules | 3 | 1 (full) | 1 | 5 | S2c, S2d | S2b; owner licence receipts before any pack shows | hub `src/{downloads,requests}/`, `config/{packs,materials-pilot}.json`, hub shared files after S2b |
| **S3** | room-only participant id, 1-hour board in paid rooms, nickname rule, clear-on-end tests | 1.5 | 0.5 (full: kid data) | 1 | 3 | S4 | S2c, S2d | vocab and game ranking files, Room DO ranking slot |
| **S4** | teacher-only loader and route shutdown, the 11 events, analytics tests, pricing and pilot report script | 1.5 | 0.5 (full: teacher data, production writes) | 1 | 3 | S3 | S2c, S2d, S6 | vocab `analytics.ts`, `avery-gate/analytics.ts`, hub `src/analytics/`, `scripts/pricing-test-report.ts` |
| **S5** | production D1, R2, namespaces; published consent screen; live key, provisioning, readback; tax gate passed; first real purchase, cancel, refund on the live site; receipts; fee lines; demos re-recorded (free round and paywall; paid screens with a `grantAccess` staff account) | 1.5 | 0.5 (full) | 1 | 3 | none | all above; S0c live; For JJ items 1-3 | ops docs, demo outputs |

**Totals:** build 23.5, review 9.75, fix 9: **42.25 days of work, about 51 with 20% contingency** (42.25 x 1.2 = 50.7; one session at a time).

**Elapsed time (3 builders, 1 panel):**

| Phase | What runs | Days |
|---|---|---|
| 1 | S1-fix, S2a-fix, S0c side by side; their panels one after another | 2.5 |
| 2 | S0d | 1 |
| 3 | S2b | 7 |
| 4 | S2c (build 2.5), S6 (build 3) and the S2d shared module (build 1) start together; the five game builders use the free builder slots (days 1.5 to 4.5); one panel at a time: module contract, S2c, game 1, S6, games 2 to 5; S2c and S6 fixes; then the integration commit, the merged full panel and its fix day | 8.25 |
| 5 | S3 panel and fixes, then S4 (needs S2d merged) | 3 |
| 6 | S5 | 3 |
| | **Base 2.5 + 1 + 7 + 8.25 + 3.5 + 3 = 25.25; with 20% contingency about 30 working days (30.3)** | |

Outside our control and added on top: Google consent publishing and brand review, Stripe keys, the tax check, the licence check, JJ's legal wording.

```
S1-fix --+
S2a-fix -+--> S0d --> S2b --+--> S2c --------------------------------+--> S3 --+
S0c (any time, live before S5)  |                                     |         |
                                +--> S2d (module -> 5 games -> merge) +--> S4 --+--> S5
                                +--> S6 ----------------------------------> S4  |
(owner licence receipts) --> S6 packs visible                                   |
(JJ: Google, Stripe, tax) ------------------------------------------------------+
```

## Six-month operations checklist (S5 exit criteria)

| Item | Check | How often |
|---|---|---|
| Portal | test and live portals allow the same three actions | launch and after changes |
| Cancel timing | period-end cancel with and without grace; monthly-to-yearly runbook | launch |
| Price change | notice window and the monthly pro-rata cancel runbook | before any change |
| Failed payments | Stripe retries and emails on; our grace matches | monthly |
| Webhooks and reconciliation | alerts on failures, drift, missed runs | always / daily |
| Google sign-in | secret rotation; callbacks; a real school account signs in | each term |
| Disputes and refund balance | runbook owner and deadline; available balance | per dispute / monthly |
| Keys | hash keys, webhook secret, Google secret, game keys, cache keys | 6 months or on a leak |
| Data deletion | retention, request and expired-row crons ran | monthly |
| Isolation | tests pass | every deploy |
| Backups | weekly export; restore rehearsed | weekly, each term |
| Packs | every visible pack's licence receipt matches its file; one stamped download opened | each new pack |
| Kid logs | game Workers still have logs off; no IP stored | each deploy |
| Materials pilot | report run; stop rule checked | weekly during the pilot |

## Risks

| Risk | Grade | What we do |
|---|---|---|
| A hard paywall after one round loses teachers | C | pricing test and `paywall_shown` to `checkout_started`; config changes it without code |
| Cookie reset gives more free rounds | B | accepted (D1) |
| Browser-run modes bypassed by rewriting JavaScript | B | accepted pending JJ (D2) |
| Revocation lags during a hub outage | C | bounded: 24 hours for single-screen (D4), one room lifetime for rooms (D3) |
| A district blocks outside apps on teacher Google accounts | B | test with a real school account in S2c; email magic link fallback (about 1 day) |
| Consent screen stays in Testing | B | For JJ item 1 now |
| Ops receipts or issues leak in the public repo | A (repo is public) | S0d before S2b; until then nothing sensitive is committed to little-games |
| Packs shared after a monthly or cancelled plan | C | yearly only, email stamp, daily cap, licence line |
| A pack file changes after its licence check | C | per-file sha256 receipt hides it |
| Stamping exceeds the Worker CPU limit | C | measured in S6; failure is not counted and alerts |
| Children's IP addresses kept in logs | B | logs off in game Workers; checklist row |
| Tax on packs differs from a software subscription | C | For JJ item 3 |
| Receipts show Ownly Network LLC | A | stated on the subscribe card |
| Refund later re-granted by reconciliation | B | `accessFor` reads charges, disputes and refund ops |

## QA bar (before anything reaches JJ)

1. `tsc --noEmit` on the hub, the vocab app and each gated game.
2. Tests green: `accessFor` rows, token protocol, gate per game, grants, cache, concurrency, isolation, webhooks, hub-down, analytics, downloads, requests, kid-privacy checks.
3. Live on staging: real Google sign-in with two accounts; in each game the free round then the paywall; an anonymous room's end on a teacher screen and a second tablet; a second anonymous room refused at creation; test purchases of both plans; paid rounds in every game; a paid room from a second tablet; portal cancel and grace; refund ends access at the next round; a stamped pack opened and its footer read; a request delivered as a download; sign out everywhere reaches every game. State what was live and what is assumed.
4. Visual check on a phone and a tablet: paywall, subscribe card, "Signed in as", account page, packs page, stamped footer on every page size, device picker, ranking, kid join screen with its privacy link.
5. Re-record each gated game's demo on the live site after S5.
6. Reviews per slice; Codex reviews before anything reaches JJ.

## Open questions for JJ

| Question | Default until she answers |
|---|---|
| Accept the browser-run bypass (D2)? | accepted |
| Every row D1 to D13 | stands |
| Tax (home state, taxability with packs, other states) | accountant, before S5 |
| Legal placeholders and phone number | owner, before S0c publishes |
| Pack licence receipts | owner, per file, before S6 shows a pack |
| Where dispute evidence is kept (teacher data) | a private folder JJ names in `dispute.md` |
| A game's "Sign out" ends the whole device's hub session | yes, as built |

## Follow-ups (not in this plan, with the reason)

| Item | Why not now |
|---|---|
| Paid agent path (teacher-issued API key) | agent-native gap; no paying agent user yet |
| Long-term class ranking | blocked by the consent path |
| AI-made packs | only if the materials pilot passes |
| Drop the deprecated free-tier columns and vars | needs one release with no reader first |
| One-page written security plan and the 30-day school breach notice (COPPA 312.8, Illinois SOPPA) | owner and legal document work, not code; before the first school contract |
| Children pick generated nicknames instead of typing (stronger option from the legal checklist) | a WHAT for JJ; the one-word rule is the minimum |
| Staging hostname without the owner's handle (`hub-staging.averystudio.org`) | cosmetic; decision 13 fixed the current name |
| AEO plan for the games page | separate track |

### Creator marketplace (owner idea, 2026-09-29, phased, self-funded)

Owner's words: "like twinkl, the platform where teachers submit their work to sell, we can build a chinese only website for all the chinese teachers to submit their work to sell, super niche, but also pretty big market now that immersion is in... we dont have investment money, so things have to sell first with enough revenue, we then scale."

| Phase | What teachers see | Sellers | Trigger to start the next phase |
|---|---|---|---|
| Phase 1 (this plan) | $29 a year plan with six games, both generators, Avery packs | none, Avery only | 100 paying teachers |
| Phase 2 | same plan; library grows with 5 to 10 invited Chinese teacher-creators; their word lists feed the games | invited and curated; paid from a revenue pool by member downloads (Twinkl and Spotify style); payouts through Stripe Connect Express so tax forms are handled; QA gate (the Avery product-QA standard) built before any seller tool | 300 paying teachers, or the pool pays a creator more than TPT does |
| Phase 3 | open submissions, creator profiles, search | anyone, QA gate before listing | funds itself from phase 2 |

What this plan does today so the marketplace is an extension, not a rewrite: the `packs` catalog carries a `creator_id` (default the owner) and the per-file licence receipt; nothing else is built until the phase 2 trigger. Risks: two-sided cold start, TPT's network effects, and Chinese-content curation being both the expensive part and the whole value. The owner's separate deep-research (browser session) is not yet in the vault; it should be filed next to the 2026-09-29 market report before phase 2 planning.

## Sources read for this version

This plan's earlier versions and their reviews (local review files); the S1 and S2a build reports; `origin/feat/avery-hub` at `85901f9` (`wrangler.jsonc`, `docs/HUB-API.md`, migrations list); `origin/feat/avery-stripe-model` at `a3e29d1` (`src/stripe/access.ts`); the five game Workers and the vocab repo as listed in the six-game table; the joydong.org legal page draft; the materials market research summary; the legal checklist and its reviews; `gh repo view joydai2026-del/little-games` (PUBLIC), 2026-09-29; web sources from version 2 (Cloudflare RPC and D1, Stripe Checkout, products, statement descriptors, refunds, tax, Google OpenID Connect, FTC COPPA FAQ), read 2026-09-28.
