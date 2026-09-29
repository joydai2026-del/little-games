# HubService: how a game talks to avery-hub

avery-hub owns Google sign-in, the teacher database and the free/paid rules for every Avery game.
A game never stores teacher data and never sees a teacher id. It holds one random **game session id** in a cookie and
passes it to `HubService` methods over a Cloudflare **service binding** (RPC). There is no HTTP API for any of this:
`/internal/*`, `/rpc` and every method name are 404 on the public hub.

Anonymous free play never needs the hub and must keep working when the hub is down.

**No free tier (the owner, 2026-09-29).** A teacher gets ONE free round per game on her device without signing in. The GAME
Worker enforces that (the hub is not involved). After that she signs in and subscribes ($29 a year or $4.99 a month).
In the hub this is `FREE_TIER_ENABLED` = `"false"` (the default): `useTaste` and `switchFreeMode` return
`{ ok: false, error: "disabled" }`, `entitlement` returns only `{ plan, accessUntil }`, and lists, classes and room
passes need paid access. The old free-tier code (free game, taste round, cooldown, one free list) is kept behind the
flag, off.

## 1. Wire the binding (game `wrangler.jsonc`)

```jsonc
"services": [
  { "binding": "HUB", "service": "avery-hub", "entrypoint": "HubService" }
],
"vars": {
  "GAME_ID": "vocab",                                   // must be a key in the hub's GAME_REGISTRY
  "HUB_ORIGIN": "https://hub.averystudio.org"
},
"env": {
  "staging": {
    "services": [{ "binding": "HUB", "service": "avery-hub-staging", "entrypoint": "HubService" }],
    "vars": { "GAME_ID": "vocab", "HUB_ORIGIN": "https://avery-hub-staging.joyd-ai-2026.workers.dev" }
  }
}
```

Secret on the game: `HUB_GAME_KEY` (see `ops/rotation.md`). The hub's `GAME_REGISTRY` entry for the game lists its
`keyHash`, its exact return URLs (`https://<game>/auth/finish`), the methods it may call and its mode ids. Until the
hub has a non-empty `keyHash` for the game, every call returns `{ ok: false, error: "refused" }`.

Every method takes `caller = { gameId: env.GAME_ID, gameKey: env.HUB_GAME_KEY }` first and returns
`{ ok: true, ... }` or `{ ok: false, error }`. Treat a thrown error or a timeout as "hub down" (see section 5).

## 2. Sign-in hand-off (the only way a game gets a session)

| Step | Where | What to do |
|---|---|---|
| 1 | Game Worker, `GET /auth/signin` | Make 32 random bytes `bind` (base64url). Set cookie `__Host-avery_bind=<bind>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`. Redirect to `${HUB_ORIGIN}/auth/start?game=${GAME_ID}&bind=${sha256hex(bind)}` |
| 2 | Hub | Google sign-in (skipped if she is already signed in to the hub), device limit, then redirects to the registered return URL with `#t=<token>` in the **fragment** |
| 3 | Game page `/auth/finish` | Read `location.hash`, `history.replaceState` to clear it at once, `POST /auth/finish` with `{ token }` (same-origin, JSON) |
| 4 | Game Worker, `POST /auth/finish` | Check `Origin` is the game's own. `HUB.redeemHandoff(caller, token, bindCookie)`. On ok: set `__Host-avery_game=<gameSessionId>; Path=/; Secure; HttpOnly; SameSite=Lax` (no Max-Age needed; the hub enforces lifetimes), clear `__Host-avery_bind`, return `{ email }` |
| 5 | Teacher screens | Show "Signed in as <email>" |

The token is single-use, lives 60 seconds (`HANDOFF_TOKEN_SECONDS`), works only for this game and only in the browser
holding the matching bind cookie. Any failure: show "Can't sign in right now. You can still play your free game."

`/auth/start` also takes `&return=<url>` when a game has several registered return URLs (staging lists a localhost one
too); it must match exactly.

## 3. Methods

`gs` = the game session id from the `__Host-avery_game` cookie. Every `gs` method refuses a session minted for another
game (`signed_out`), an ended one (`signed_out`), and a bad caller (`refused`).

| Method | Returns on success | Errors besides `refused` / `signed_out` |
|---|---|---|
| `redeemHandoff(caller, token, bindValue)` | `{ gameSessionId, email, displayName }` | `expired`, `rate_limited` |
| `resolveSession(caller, gs)` | `{ email, displayName, gameId }` | |
| `entitlement(caller, gs)` | `{ plan: "free"\|"paid", accessUntil: ms\|null }` ("free" means not subscribed). For showing the screen only; never trust it for a decision. With `FREE_TIER_ENABLED` on it also returns `freeGame`, `freeGameLockedUntil`, `freeGameChoices`, `tasteRoundsLeft`, `listLimit`, `listsSaved`, `modesThisGame`, `trialDays`, `anonFreeRounds`, `email` | |
| `authorizeRound(caller, ...)` | not in S1 | `not_implemented_in_s1` (S2b) |
| `useTaste(caller, gs, mode)` | free tier only: `{ grantId, tasteRoundsLeft }` | `disabled` (default), `unknown_mode`, `not_needed`, `no_taste_left` |
| `switchFreeMode(caller, gs, mode)` | free tier only: `{ freeGame, lockedUntil }` (one game+mode across all games, cooldown `FREE_MODE_SWITCH_COOLDOWN_DAYS`) | `disabled` (default), `unknown_mode`, `not_allowed`, `already_free`, `cooldown` |
| `listLists(caller, gs)` | `{ lists: [...] }` (paid; empty when not subscribed, her lists stay stored and come back when she subscribes) | |
| `getList(caller, gs, listId)` | `{ list: { id, title, level, items, ... } }` (paid) | `not_found` |
| `saveList(caller, gs, { id?, title, level?, items })` | `{ id }` (paid; up to `PAID_LIST_LIMIT` lists). No `id` = new list; with `id` = replace one of hers. `items` must be plain JSON | `paid_only`, `bad_list`, `list_limit`, `not_found` |
| `deleteList(caller, gs, listId)` | `{}` (paid) | `not_found` |
| `listClasses(caller, gs)` | `{ classes: [...] }` (paid; empty otherwise) | |
| `saveClass(caller, gs, { id?, name, listId? })` | `{ id, classCode? }` (paid only) | `paid_only`, `bad_class`, `not_found` |
| `deleteClass(caller, gs, classId)` | `{}` (paid only) | `paid_only`, `not_found` |
| `mintRoomPass(caller, gs, roomCode)` | `{ passId, allowedModes, expiresAt }` (paid: every mode of this game) | `paid_only`, `bad_room`, `revoked` (access or session changed while minting), `no_modes` |
| `checkRoomPass(caller, passId)` | `{ valid: true, roomCode, allowedModes, expiresAt }` or `{ valid: false, reason: "unknown"\|"expired"\|"revoked" }`. Any `valid: false` means: drop the room's paid modes. Refund, revoke, account deletion and account moves all give `revoked` | |
| `signOut(caller, gs)` | `{}`. Ends this browser's hub session and every game session made from it (this device leaves every Avery game, not only this one) | |

Every method may also return `{ ok: false, error: "unavailable" }`: an internal hub error (logged with the tag
`AVERY_ALERT` so it reaches the owner's alerts) or the hub not configured. The hub never throws across RPC; a THROWN RPC call
means the hub was unreachable. A new hand-off for the same game in the same browser ends that game's previous session
(one live game session per game per browser).

How a game must treat `unavailable` (and a thrown call), per method:

| Method | Treat as |
|---|---|
| `redeemHandoff` | sign-in failed: "Can't sign in right now. You can still play one free round of each game." Keep the bind cookie; she can tap Sign in again |
| `resolveSession`, `entitlement` | not signed in / not subscribed for this page view; do NOT clear the game cookie (the next call may work) |
| `authorizeRound`, `useTaste`, `switchFreeMode`, `mintRoomPass` | refused: no paid action starts |
| `listLists`, `getList` | "Can't reach your lists right now"; show nothing saved |
| `saveList`, `deleteList`, `saveClass`, `deleteClass`, `listClasses` | "Can't reach your lists right now. Your list is still here; try again in a minute." Nothing was written |
| `checkRoomPass` | same as the hub not answering: the stored pass decides until it expires (`ROOM_PASS_HOURS`). An internal error here is alert-tagged because a persistent one would delay revocation |
| `signOut` | clear the game cookie anyway and show "signed out"; tell the teacher to use "Sign out everywhere" on her account page if she is worried |

Same-zone note: requests our own Workers send to the hub's public hostname are our code, never teacher traffic; they
carry no `request.cf`, so the hub skips the per-address bucket for them and keeps the per-binding one.

Item ids are the hub's. `items` is any JSON array the game defines (up to `LIST_MAX_ITEMS` and `LIST_MAX_BYTES`).

## 4. Room passes (S2b uses these; available now)

Store `passId` in the Room Durable Object's own storage (never send it to a device). At each round start, check the
stored mode list and expiry; if the hub answers, also call `checkRoomPass` and drop to the free mode on
`valid: false`. If the hub does not answer, the stored pass decides until it expires (`ROOM_PASS_HOURS`, 4).

## 5. When the hub is down

| Moment | Teacher sees |
|---|---|
| Sign-in or hand-off fails | "Can't sign in right now. You can still play your free game." |
| Saving a list fails | "Can't reach your lists right now. Your list is still here; try again in a minute." (keep the draft in sessionStorage) |
| Taste, switch, class action | refused; only the free mode |
| Room already open with a pass | nothing changes until the pass expires |

## 6. Hub pages a game may link to

| Link | What |
|---|---|
| `${HUB_ORIGIN}/me` | her profile: signed in as, free game and when it can change, lists count, devices, download my data, delete my account, sign out, sign out everywhere |
| `${HUB_ORIGIN}/auth/start?game=...&bind=...` | sign in (step 1 above) |

Support address shown on every hub page: hello@averystudio.org.

Policies page line (S0b): school seat emails are kept until the seat expires plus 400 days (`SEAT_GRANT_RETENTION_DAYS`), then deleted by the hub's daily clean-up.
