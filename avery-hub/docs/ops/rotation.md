# Key rotation (every 6 months, or at once on any leak)

## Session hash keys (`SESSION_HASH_KEY_V<N>`)

Every stored hash (hub sessions, game sessions, hand-off tokens, OAuth state, room passes) is an HMAC with a numbered
key, and every presented value carries its key number (`v2.<random>`). Rotation never signs anyone out.

| Step | What |
|---|---|
| 1 | Make a new random value of at least 32 bytes and set it as the NEXT version: `wrangler secret put SESSION_HASH_KEY_V2 [--env staging]` |
| 2 | Change the var `SESSION_HASH_KEY_CURRENT` to `2` in `wrangler.jsonc` (both envs) and deploy |
| 3 | New sessions and tokens now use v2. An existing hub session is re-issued under v2 the next time it is used (the rotation path in `src/auth/hub-session.ts`) |
| 4 | After `SESSION_MAX_DAYS` (90) every live hub session is v2. Game sessions last at most `GAME_SESSION_HOURS`, room passes `ROOM_PASS_HOURS` |
| 5 | Then `wrangler secret delete SESSION_HASH_KEY_V1` |

On a LEAK, skip the wait: after step 2, sign everyone out (`DELETE FROM sessions` on the database, which cascades to
game sessions), then delete the old key.

## Google client secret

| Step | What |
|---|---|
| 1 | Google Cloud console, the hub's OAuth client, "Add secret" (Google allows two at once) |
| 2 | `wrangler secret put GOOGLE_CLIENT_SECRET [--env staging]` with the new one; deploy not needed |
| 3 | Sign in once on that environment to prove it |
| 4 | Disable, then delete, the old secret in the console |

## Game keys (one per game)

A game proves who it is to `HubService` with `{ gameId, gameKey }`. The game holds the key as its secret
`HUB_GAME_KEY`; the hub holds only `sha256(key)` as `keyHash` in `GAME_REGISTRY`. An empty `keyHash` switches the game off.

| Step | What |
|---|---|
| 1 | Make 32 random bytes, base64url (for example `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`); do not paste it anywhere shared |
| 2 | Set it on the game: `wrangler secret put HUB_GAME_KEY [--env staging]` in the game's folder |
| 3 | Compute its sha256 hex and put that in the game's `keyHash` in the hub's `GAME_REGISTRY` (the right env block); deploy the hub |
| 4 | The old key stops working the moment the hub deploys, so do steps 2 and 3 back to back; the game's signed-in teachers see "sign in again" at worst, never lose data |

A registry entry holds one `keyHash` on purpose (simple and auditable). If zero-gap game-key rotation is ever needed,
make `keyHash` a list; that is a small change in `src/config.ts` and `src/rpc/core.ts`.

## Stripe webhook secret (S2a)

Roll it in the Stripe dashboard with the old secret kept alive; the verifier accepts several `v1` values while a
secret is rolled. Details land with S2a.
