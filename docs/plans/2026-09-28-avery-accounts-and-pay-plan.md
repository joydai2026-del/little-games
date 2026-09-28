---
date: 2026-09-28
topic: Avery accounts and pay (Google sign-in, D1, Stripe under Ownly Network LLC)
status: plan, not started
branch: feat/avery-accounts-pay-plan
decision board: vault projects/little-games/2026-09-28-pricing-and-stripe-options.html (round 2)
---

# Avery accounts and pay: build plan

## In one minute

Teachers sign in with Google and get a saved profile: their word lists, classes, play history and subscription. A new service in this repo, **avery-hub**, owns sign-in, the teacher database, Stripe and the answer to "has this teacher paid?". Every game stays its own Worker and asks the hub. Kids never sign in and never see a paywall; they type only the nickname they already type to join a room.

Money goes through the **existing Ownly Network LLC Stripe account**. The Avery product carries the statement name **AVERY STUDIO**. Pricing is a test: **$39 a year + $6.99 a month**. Free is **1 list + 1 mode**, with a 14-day switch cooldown and one taste round of a locked mode per day.

Five slices, about **14 days of work, about 8 on the critical path**. Live mode waits for the tax registrations (a JJ and accountant step).

Claim grades: **A** = read today (source named), **B** = standard platform behaviour not re-read today, **C** = estimate or judgement.

## JJ decisions this plan builds on (2026-09-28)

| # | Decision | Where it lands |
|---|---|---|
| 1 | Teachers sign in with Google (school or personal Gmail), stay signed in, and get a profile: lists, classes, history, subscription. Different teachers' data must never overlap. Kids type nothing but a nickname and never see a paywall. | S1, Data model |
| 2 | One Stripe account: Ownly Network LLC. Avery Studio is part of it. Seller for tax is Ownly Network LLC. | S2, S5 |
| 3 | $39 a year + $6.99 a month as a pricing test with the board's thresholds. Free = 1 list + 1 mode. | S2 |
| 4 | Free mode can switch, with a nudge toward subscribing. | Free-tier gate |
| 5 | Teacher-side product analytics matter. Teacher screens only, never kid screens, no child data. AEO is a separate later track. | S4 |
| 6 | Student rankings: nickname + random device id, class ranking visible, 1 hour by default, class-long when the teacher turns it on. | S3 |

## Architecture

### The pieces

| Piece | Where | What it does | Talks to |
|---|---|---|---|
| **avery-hub** (new Worker) | this repo, `avery-hub/` | Google sign-in, teacher sessions, D1 database, Stripe Checkout, webhooks, Customer Portal link, reconciliation cron, entitlement API, game tokens | Google, Stripe, D1, PostHog (server events) |
| **D1 database** `avery_hub` | bound to avery-hub only | teachers, sessions, lists, classes, round history, subscriptions, stripe_events, rankings, one-time tokens | avery-hub only |
| **Vocab Generator** (existing Worker) | repo `joydai2026-del/bilingual-vocab-game` | the game; reads and saves lists through the hub; opens rooms with a room pass | avery-hub (service binding), kid devices |
| **Trace Race, Tianzige, later games** (existing or new Workers) | this repo | same pattern as the vocab app once they get paid features | avery-hub (service binding) |
| **Kid devices** | browsers on tablets | join a room, play, see the ranking | the game's Room Durable Object only |
| **Stripe** (Ownly Network LLC account) | Stripe | Checkout, subscriptions, portal, receipts | avery-hub webhooks |
| **Google** (OAuth client in a Google Cloud project) | Google | "Sign in with Google" | avery-hub |

### Why games get a token by redirect

Each Worker lives on its own `*.workers.dev` address. `workers.dev` is on the Public Suffix List (A, https://publicsuffix.org/list/public_suffix_list.dat), so browsers treat every game as a separate site and one sign-in cookie cannot be shared across them. So the hub hands each game a one-time token by redirect, and the game swaps it for its own session on the server.

### Sign-in and hand-off flow

| Step | Who | What happens |
|---|---|---|
| 1 | Teacher on a game | Taps "Sign in with Google". The game sends her to `hub/auth/start?game=<game id>`. The game id must be in the hub's allowlist (`GAME_RETURN_URLS` in config). |
| 2 | Hub | If her hub session cookie is valid, skip to step 5. Otherwise start Google's server flow: a random `state` stored server-side, a random `nonce`, scopes `openid email profile` (A, https://developers.google.com/identity/openid-connect/openid-connect). |
| 3 | Google | She picks her account. Google returns a `code` and our `state`. |
| 4 | Hub | Checks `state`, swaps the `code` for tokens server-side, checks the ID token's signature, issuer, audience (our client id) and nonce. Finds or creates the teacher by Google's `sub`, which Google says never changes, not by email, which can change (A, same page). Sets the hub session cookie: random id, stored hashed, `HttpOnly`, `Secure`, `SameSite=Lax`, idle timeout `SESSION_IDLE_DAYS` (30). |
| 5 | Hub | Makes a one-time game token (random, stored hashed, bound to the game id, expires in `GAME_TOKEN_SECONDS` = 60) and redirects to `game/auth/finish#t=<token>`. The fragment never reaches server logs or referrers. |
| 6 | Game page | Posts the token to its own Worker, then clears it from the address bar. |
| 7 | Game Worker | Redeems the token with the hub over a service binding (Worker-to-Worker call on the same Cloudflare account, not over the public internet, B). Gets back the teacher id. Sets its own game session cookie (`GAME_SESSION_HOURS` = 12). |
| 8 | Game Worker | For every paid or saved action, asks the hub's entitlement API over the service binding. The browser never decides. |
| 9 | Game Worker, opening a room | Asks the hub for a room pass: which modes this room may use, until when (`ROOM_PASS_HOURS` = 8). Stores it in the Room Durable Object in its own storage slot, the same way `hostKey` is kept out of public state today (A, `src/worker/persist.ts`). Kid devices only ever talk to the room. |

Later option: if all games move under `averystudio.org`, one cookie could cover them. The token hop still works then, so nothing is rebuilt.

### Hub API (first version)

| Route | Caller | Purpose |
|---|---|---|
| `GET /auth/start`, `GET /auth/callback` | teacher browser | Google sign-in |
| `POST /auth/signout`, `POST /auth/signout-everywhere` | teacher browser | end one or all sessions |
| `GET /me` | teacher browser on the hub | her profile page: plan, lists, classes, "Manage billing" |
| `POST /billing/checkout` | teacher browser | start Checkout for a plan from config |
| `GET /billing/return?c=<one-time code>` | teacher browser | server-side check of the Checkout Session, then redirect back to the game |
| `POST /billing/portal` | teacher browser | open the Stripe Customer Portal |
| `POST /stripe/webhook` | Stripe | signed events |
| `POST /internal/token/redeem` | game Worker (service binding) | game token to teacher id |
| `GET /internal/entitlement` | game Worker | plan, allowed modes, list limit, free mode, cooldown date, taste rounds left |
| `GET/PUT/DELETE /internal/lists[/:id]`, `/internal/classes[/:id]` | game Worker | her saved lists and classes |
| `POST /internal/room-pass` | game Worker | mint a room pass after a live entitlement check |
| `POST /internal/taste` | game Worker | use today's taste round |
| `POST/GET /internal/rankings` | game Worker | write and read a class ranking |

Every `/internal/*` route accepts calls only through the service binding and always carries the teacher id from a redeemed game session, never from a browser field.

## Data model and per-teacher isolation

### Tables (D1)

| Table | Key | Main columns | Notes |
|---|---|---|---|
| `teachers` | `id` (random) | `google_sub` (unique), `email`, `display_name`, `analytics_id` (random), `free_mode`, `free_mode_locked_until`, `taste_day`, `taste_used`, `created_at`, `last_seen_at` | keyed on `google_sub`, never on email |
| `sessions` | `id_hash` | `teacher_id`, `created_at`, `last_used_at`, `revoked_at` | oldest signed out past `MAX_TEACHER_DEVICES` (3) |
| `lists` | (`teacher_id`, `id`) | `title`, `level`, `items_json`, `hidden`, `created_at`, `updated_at` | free: `FREE_LIST_LIMIT` (1) visible; extras hidden, not deleted, when paid access ends |
| `classes` | (`teacher_id`, `id`) | `name`, `remember_ranking`, `ranking_reset_at` | paid only |
| `round_history` | (`teacher_id`, `id`) | `list_id`, `class_id`, `mode`, `started_at`, `player_count` | her history; no kid data |
| `subscriptions` | `teacher_id` | `stripe_customer_id`, `stripe_subscription_id`, `price_id`, `plan`, `status`, `paid_through`, `cancel_at_period_end`, `dispute_open`, `reconciled_at` | written only from Stripe data fetched server-side |
| `stripe_events` | `event_id` | `type`, `object_id`, `received_at`, `processed_at` | dedupe ledger |
| `rankings` | (`teacher_id`, `scope_id`, `device_id`) | `nickname`, `points`, `rounds`, `updated_at`, `expires_at` | `scope_id` is a room code (1 hour) or a class id (class-long) |
| `one_time_tokens` | `token_hash` | `kind` (game, checkout), `teacher_id`, `game_id`, `expires_at`, `used_at` | burned on first use |

Foreign keys that point at teacher data include `teacher_id` (for example a class references (`teacher_id`, `list_id`)), so a row can never point at another teacher's list.

### The isolation rule (one query layer)

1. All SQL lives in one module, `avery-hub/src/db/`. Route handlers never touch `env.DB` directly.
2. Teacher data is reached only through `forTeacher(db, teacherId)`, which returns functions like `lists.all()`, `lists.get(id)`, `lists.save(list)`, `classes.all()`. Every statement inside carries `WHERE teacher_id = ?1`, bound to the id passed in.
3. `teacherId` comes only from a verified hub session or a redeemed game session. No request body, query string or header field can set it.
4. Admin actions (JJ moving a subscription, manual unlock) go through a separate, named `admin` module with its own tests and an audit log line.

D1 has no row-level security, so the rule is enforced in code and proven by tests (B).

### Isolation tests (must pass on every deploy)

| Test | Proves |
|---|---|
| Teacher A lists, reads, updates and deletes her own list: all succeed | the happy path works |
| Teacher A asks for teacher B's list id, class id, history row and ranking: every call returns "not found", never B's data | no cross-reading |
| Teacher A tries to update or delete B's list and class by id: B's rows are unchanged afterwards | no cross-writing |
| A request that carries `teacher_id` in its body or query for B still acts on A | the id cannot be injected |
| A class of A's cannot reference a list id of B's | foreign keys hold |
| A game token minted for A, redeemed twice, or after 60 seconds, or by a different game id: all refused | tokens cannot be replayed |
| A webhook for B's Stripe customer changes only B's subscription | money events land on the right teacher |
| Source guard: a test fails if `env.DB.prepare` appears outside `avery-hub/src/db/` | nobody bypasses the layer later |

## Free-tier gate

### Rules (all config, in `avery-hub/wrangler.jsonc` vars)

| Rule | Default | Config |
|---|---|---|
| Saved lists on free | 1 (replace any time) | `FREE_LIST_LIMIT` |
| Modes on free | 1, her pick | none |
| Switch cooldown | 14 days after a switch | `FREE_MODE_SWITCH_COOLDOWN_DAYS` |
| Taste round | 1 round of any locked mode per day, ends with a teacher-only upgrade card | `FREE_TASTE_ROUNDS_PER_DAY` |
| Before sign-in | anyone can paste a list and play one round; saving needs sign-in | `ANON_ROUNDS` (1) |
| Trial | none | `TRIAL_DAYS` (0) |

Why this pair: the cooldown keeps "1 mode" meaningful, and the taste round sells the other modes with her real class. The alternative is a one-time 7-day trial (`TRIAL_DAYS` 7), simpler but with no nudge afterwards (C).

### Where the vocab app needs the gate

Repo `joydai2026-del/bilingual-vocab-game`, paths read today (A):

| File | Change |
|---|---|
| `src/client/screens/set.ts` | Mode cards already have a "disabled reason" pattern (`skyTowerDisabledReason` and others). Add locked, taste-available and cooldown states, and the teacher-only upgrade card. |
| `src/client/router.ts` | `#/play/<mode>/...` route: check the cached entitlement before starting a locked mode; route to the taste round or the upgrade card. |
| `src/client/state.ts` | The draft stays in sessionStorage. Add "Save to my lists" and "Open my lists" through the game Worker, which calls the hub. |
| new `src/client/screens/upgrade.ts` | The upgrade card and the "Sign in with Google" button. Teacher screens only. |
| `src/worker/index.ts` | New routes: `/auth/finish`, `/api/me/*` (proxy to the hub over the service binding). Room creation (`/api/rooms`) mints a room pass; the round route, which today accepts `race`, `climb`, `dash`, `tower`, also checks the pass. |
| `src/worker/room-do.ts`, `src/worker/persist.ts` | Store the room pass in its own slot, like `hostKey`. Move the hard-coded `ROOM_TTL_MS` (2 hours) into `policy.ts` while there, per the house config rule. |
| `src/worker/policy.ts`, `wrangler.jsonc` | New vars: hub binding name, game id, `GAME_SESSION_HOURS`, `ROOM_PASS_HOURS`. |

Honest limit: single-screen play runs in the browser, so its gate is a soft gate a determined person could bypass. Rooms (the multi-tablet classroom game), saved lists and classes are enforced on the server. That matches the pickup brief's "soft $39/yr gate" (A, `docs/avery/AVERY-CLASSROOM-GAMES-PICKUP.md`).

## Stripe

### What to create in test mode (Ownly Network LLC account)

| Object | Value | Config key |
|---|---|---|
| Product | "Avery Classroom Games", `statement_descriptor` = `AVERY STUDIO` | `STRIPE_PRODUCT_ID` |
| Price, yearly | $39.00 USD, every year, lookup key `avery_yearly_v1` | `STRIPE_PRICE_YEARLY` |
| Price, monthly | $6.99 USD, every month, lookup key `avery_monthly_v1` | `STRIPE_PRICE_MONTHLY` |
| Webhook endpoint | `https://<hub>/stripe/webhook`, events below | `STRIPE_WEBHOOK_SECRET` (secret) |
| Portal configuration | cancel at period end, update card, invoice history; plan switch and cancel-now off | `STRIPE_PORTAL_CONFIG_ID` |

A setup script `avery-hub/scripts/stripe-setup.ts` creates all of this and refuses any key that is not a test key, copying the idea of the CRM's setup script (A, board round 1).

### Statement name finding

A Product's `statement_descriptor` is documented as "Only used for subscription payments", up to 22 characters (A, https://docs.stripe.com/api/products/object). For a subscription charge Stripe uses the Invoice's descriptor first, then the Product's, then the account default (A, https://docs.stripe.com/get-started/account/statement-descriptors). So `AVERY STUDIO` on the product shows inside the Ownly account without a second account. Stripe also warns some banks display descriptors incorrectly or not at all (A, products page). S2a checks the first test charge, including the first payment made through Checkout, and reads the charge's calculated descriptor (B).

### Webhook events handled

`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.

### Idempotency and reconciliation

| Rule | How |
|---|---|
| Signature first | Raw body checked with the CRM verifier before anything else; failure is a 401, never a 500. |
| Event id dedupe | Insert `event_id` into `stripe_events`; a repeat is acknowledged 200 and skipped. |
| Same object, two events | Processing for one subscription runs under a lock keyed on the object id, so two deliveries cannot race. |
| Never trust the event body for state | Always fetch the latest Subscription (and Charge or Dispute) from Stripe, then write the state table result. That makes out-of-order and repeated events harmless. Never order by the event's `created` time. |
| Daily reconciliation | Cron Trigger at `RECONCILE_HOUR_UTC` lists every subscription we know, fetches it from Stripe, fixes drift, and alerts JJ if it fixed anything or did not run. |
| Checkout return | The return URL carries only our one-time code. The server fetches the Checkout Session and Subscription, checks the price id is ours and payment is complete, then burns the code. |

### State table

| Stripe state | Access | Config |
|---|---|---|
| trialing | paid until the trial ends | `TRIAL_DAYS` (0) |
| active | paid through `paid_through` | none |
| past_due | paid during grace | `PAST_DUE_GRACE_DAYS` (7) |
| unpaid | free | none |
| cancel at period end | paid through `paid_through` + grace, then free | `ACCESS_END_GRACE_DAYS` (7) |
| canceled now | free | none |
| full refund | free once confirmed; subscription cancelled | none |
| partial refund | no change | none |
| dispute opened | paused (free) while open | `DISPUTE_ACTION` (pause) |
| dispute won | back to what the subscription says | none |
| dispute lost | free | none |

Each row is a unit test on a plain function `accessFor(subscriptionSnapshot, now, policy)`.

### Refund policy (default)

Yearly: full refund within 14 days, no questions asked (`REFUND_WINDOW_DAYS` 14), done by JJ from the Dashboard. Monthly: cancel any time, no refund. Card fees are not returned on refunds (A, https://docs.stripe.com/refunds).

### Tax gate before live mode

Seller: Ownly Network LLC. Stripe Tax collects only where registrations are added; the business decides where it owes tax (A, https://docs.stripe.com/tax/registering). Before S5: JJ and her accountant confirm the home state, whether a digital teaching subscription is taxable there, the product tax code, and any registrations; then Stripe Tax is switched on. This plan does not guess any of those.

### Minimum secrets (names only)

| Secret | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | restricted key (test first, live in S5) |
| `STRIPE_WEBHOOK_SECRET` | webhook signature |
| `GOOGLE_CLIENT_SECRET` | Google sign-in |
| `SESSION_HASH_KEY` | hashes session ids and one-time tokens |
| `GAME_TOKEN_KEY` | signs game tokens |

Not secrets, so they live in `wrangler.jsonc` vars: `GOOGLE_CLIENT_ID`, `POSTHOG_PROJECT_KEY` (public by design), price ids, portal config id, grace periods, limits, `STRIPE_MODE`.

### Reuse from the CRM

Copy `front-desk/src/payments/webhook-verify.ts` from `joydai2026-del/crm` (last changed in commit `de8d4ca`) into `avery-hub/src/stripe/webhook-verify.ts` unchanged, with a header naming the source. It uses Web Crypto only, checks a 5-minute window, rejects malformed or wrong-length signatures and compares in constant time (A). Port its signature test cases from `front-desk/test/stripe-webhook.test.ts`: valid, wrong value, wrong length, stale timestamp, missing header, malformed header, unhandled event type acknowledged (A). The 300-second window is Stripe's documented default; it becomes `STRIPE_SIGNATURE_TOLERANCE_SECONDS` in config.

## Student rankings

| Item | Rule |
|---|---|
| Identity | Nickname typed to join (as today, `bvg.name.v1` in localStorage, A) + a random device id made in the browser and kept in localStorage. No fingerprinting: nothing is read about the device. |
| Visible | Ranking by points on the teacher's screen and every tablet, reusing `src/client/room/ranking.ts` ordering (A). |
| Memory | Room scope: `RANKING_KEEP_MINUTES` (60), then gone. Class scope when the teacher turns on "remember this class": `CLASS_RANKING_KEEP_DAYS` (120) or until she resets. |
| Stored | nickname, device id, points, rounds, teacher id, room code or class id, expiry |
| Never stored | real names (the join screen says "use a nickname"), email, photo, voice, IP address, location, device details |
| Clean-up | the hourly cron deletes expired ranking rows |
| COPPA | A persistent identifier is personal information unless used only for "support for internal operations" with nothing else personal collected; a nickname counts only when it works as contact information (A, https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions, sections A and J). The 1-hour ranking fits. Class-long ranking ships behind the teacher's switch, off by default, after a privacy-lawyer look (C). |
| Later | Older kids signing in with school Gmail needs school consent under COPPA, limited to school use with no other commercial purpose (A, same FAQ, section N). Not in this plan. |

## Analytics (teacher screens only)

| Item | Rule |
|---|---|
| Tool | PostHog, configured like joydong.org's `assets/analytics.js`: memory persistence (no cookies), `$ip` null and geoip off, query strings stripped, feature flags off, no session recording, no autocapture, external script loading off (A, repo `joydai2026-del/joydong.org`, live site checked today). Copy that file's settings, not a fresh setup. |
| Who is sent | `analytics_id`, a random id on the teacher row. Never email, name or Google id. |
| Where it loads | Teacher screens only: home, set review, mode picker, upgrade card, hub profile. Never on join, play or ranking screens on kid devices. |
| Server events | Money events are sent by the hub after Stripe confirms. |
| Kid-screen exclusion test | A browser test opens every kid route (join, play, ranking, room) and fails if any request goes to a PostHog host or `window.posthog` exists. A unit test fails if the analytics loader is imported from a kid route module. |

Events:

| Event | When | Extra detail |
|---|---|---|
| `teacher_signed_in` | Google sign-in finished | first time or returning |
| `list_saved` | she saves a list | word-count band, never the words |
| `free_list_replaced` | free teacher overwrites her list | none |
| `round_started` | she starts a game from her screen | mode, room or single screen, player-count band |
| `free_mode_switched` | free teacher switches mode | from, to |
| `switch_blocked_cooldown` | switch tried inside the cooldown | days left |
| `taste_round_played` | taste round starts | mode |
| `upgrade_card_shown` | upgrade card appears | where |
| `checkout_started` | she taps a plan | plan |
| `subscription_changed` | hub, after Stripe confirms | started, renewed, cancel scheduled, ended, refunded; plan |

AEO (answer engine optimisation) for the games marketing page is a separate, later plan: one clear page per game with plain questions and answers, structured data, the demo video, and AI crawlers allowed; joydong.org's weekly report already counts AI fetches and can measure it (A for the report, C for the approach).

## Slices and parallel execution map

| Slice | Work | Days (C) | Parallel with | Depends on |
|---|---|---|---|---|
| **S1** Hub sign-in + D1 + saved lists | `avery-hub/` Worker, Google sign-in, sessions, D1 schema and migrations, `forTeacher` layer and all isolation tests, lists and classes, game token hand-off, profile page; vocab app reads and saves lists through the hub; reword the house-rule line in `CLAUDE.md` and `AGENTS.md` | 4 | S2a | Google Cloud OAuth client (JJ names the owner account) |
| **S2a** Stripe setup + state table | test-mode setup script (product with AVERY STUDIO, two prices, webhook, portal config); `accessFor` state table with a test per row; CRM verifier copied with its tests | 2 | S1 | nothing |
| **S2b** Checkout, webhooks, gate | Checkout start and return check, webhook route with dedupe and fetch-latest, reconciliation cron, entitlement API, room pass, free gate in the vocab app (list limit, cooldown, taste round, upgrade card); full test-mode run: buy, second device, cancel, partial and full refund, test dispute, missed-webhook recovery | 3 | S3, S4 | S1, S2a |
| **S3** Rankings | device id, ranking writes and reads, 1-hour expiry, class-long switch (off by default), clean-up cron | 2 | S2b, S4 | S1 |
| **S4** Analytics | PostHog loader for teacher screens, the 10 events, server events from the hub, kid-screen exclusion tests | 2 | S2b, S3 | S1 |
| **S5** Live mode | live restricted key, live webhook and portal config, one real purchase, cancel and refund on the live site, receipt shows AVERY STUDIO | 1 | nothing | S2b, tax gate (JJ and accountant) |

Total about 14 days of work. Critical path: S1 (4) then S2b (3) then S5 (1) = about 8 days, plus however long the tax gate takes.

```
S1 ─────┐
        ├─> S2b ─> S5 (after tax gate)
S2a ────┘
S1 ─> S3   (beside S2b)
S1 ─> S4   (beside S2b)
```

## Risks

| Risk | Grade | What we do |
|---|---|---|
| A district blocks outside apps on teacher Google accounts | B | test with a real school account in S1; magic-link email (board option B2) is the fallback, about 1 more day |
| Google shows an "unverified app" screen or asks for brand verification | B | only `openid email profile` scopes; set the consent screen name, logo and support email in S1 |
| Bank shows the Ownly name instead of AVERY STUDIO | A (Stripe warns banks vary) | check the first test and live charge; the receipt email also names the product |
| Single-screen play gate is bypassable | B | accepted as a soft gate; rooms, lists and classes are enforced on the server |
| Class-long rankings and COPPA | C | off by default; privacy-lawyer look before turning it on |
| House rule "No accounts, no tracking" conflicts with JJ's decisions | A | S1 rewords the line in `CLAUDE.md` and `AGENTS.md` to match the decisions |
| Webhook missed or out of order | A | fetch-latest plus daily reconciliation |
| Tax registrations take longer than the build | C | S1 to S4 run in test mode meanwhile; S5 waits |
| `admin@ownly.network` domain lapses and receipts lose their support email | A | check the renewal date or change the public support email before S5 |

## QA bar (before anything reaches JJ)

1. Static checks: `tsc --noEmit` on the hub and the vocab app.
2. Tests green: unit tests (state table, `accessFor`, token rules, gate rules), isolation tests, webhook tests.
3. Live surface on a **staging hub** and a staging vocab app: a real Google sign-in, save a list, open a room from a second device, play a taste round, buy with a test card, see the upgrade disappear, cancel in the portal, refund in the Dashboard, watch access follow the state table. State plainly what was checked live and what is still assumed.
4. Visual check: open and look at the upgrade card, profile page, mode picker and ranking on a phone and a tablet.
5. Re-record the vocab app demo on the live site after S2b, per the repo's demo rule.
6. Review: S1 (auth, isolation), S2a, S2b and S5 (money path) get the **full 4-reviewer panel** (three Claude lenses plus Codex). S3 and S4 get the default panel (one fresh Claude reviewer plus Codex). Codex reviews before anything is handed to JJ.

## Open questions for JJ (defaults stand unless she changes them)

| Question | Default |
|---|---|
| Tax registrations: Ownly Network LLC's home state, taxability, any other states | JJ and her accountant confirm before S5 |
| Refund window | 14 days full on yearly, no questions asked; monthly cancel anytime, no refund |
| Devices per teacher | 3 devices, one teacher |
| Who owns the Google Cloud project for the sign-in client | the same Google account that holds the Stripe login |
| Free tier sign-in | one-tap sign-in to save a list; before that, one round to try |

## Sources read for this plan

- Owner feedback: vault `projects/little-games/evidence/2026-09-28-pricing-board-feedback-round1.md`
- Codex challenge: `/Users/joyd/lg-scans/pricing/challenge-codex.md`
- Pickup brief: `docs/avery/AVERY-CLASSROOM-GAMES-PICKUP.md` (this repo, main)
- CRM: `front-desk/src/payments/webhook-verify.ts`, `front-desk/test/stripe-webhook.test.ts`, `front-desk/test/webhook-idempotency.test.ts`
- Vocab app: `src/client/screens/set.ts`, `src/client/state.ts`, `src/client/router.ts`, `src/client/room/ranking.ts`, `src/worker/index.ts`, `src/worker/room-do.ts`, `src/worker/persist.ts`, `src/worker/policy.ts`
- joydong.org: `assets/analytics.js`, `docs/2026-08-13-analytics-setup.md`; live https://joydong.org
- https://docs.stripe.com/api/products/object
- https://docs.stripe.com/get-started/account/statement-descriptors
- https://developers.google.com/identity/openid-connect/openid-connect
- https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- https://publicsuffix.org/list/public_suffix_list.dat
- Round-1 board sources (Stripe webhooks, refunds, tax registering, multiple accounts, pricing): see the decision board
