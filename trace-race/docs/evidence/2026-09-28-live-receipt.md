# Live receipt, Trace Race (2026-09-28, after review round 1 fixes)

- Live URL: https://trace-race.joyd-ai-2026.workers.dev (workers.dev only)
- Deployed version (from `npx wrangler deployments status`): `79ed1713-76ab-4938-bcb8-53affbbaebaf`, created 2026-09-28T15:09:26.199Z, 100% of traffic
- Branch commit deployed: the client and server fixes on `feat/trace-race` (commits `12d0f4b` and the one after it)

## 1. API gate: `node scripts/live-gate.mjs`
Run 2026-09-28T15:12:09.362Z to 15:12:39.954Z. Full JSON with every status and body:
[`2026-09-28-live-gate.json`](2026-09-28-live-gate.json). All 19 checks passed.

| Check | Result on the live site |
|---|---|
| Home page | 200 |
| `/api/strokes/我` | 200, sha256 `08616462...ac8` (= manifest), `application/json`, `nosniff`, `public, max-age=2592000, immutable` |
| Proxy rejects `..%2Fx`, `我们`, `𠮷` | 400 each |
| `/licenses/ARPHICPL.TXT` | 200, starts `ARPHIC PUBLIC LICENSE` |
| `/api/rooms/%E0` | 400 "that is not a room code" (was a 500) |
| 40,000-character body | 413 "That is too much text. Paste a shorter list (up to 4000 characters)." |
| 4,001-character paste | 400 "That paste is too long..." |
| Room DSEY made from `1. 山 shān / 2. 水 shuǐ / 3. 𠮷` | chars 山 水, missing 𠮷 |
| Late joiner strokes during the race | 409 "this race started before you joined, you are in the next one"; not on the board |
| Same stroke sent twice (race 1, seq 1) | both 200, version unchanged (5 and 5) |
| Same mistake sent twice | mistakes = 1 |
| **Race ended on the clock, nobody polling** | endsAt 1790608353709, endedAt 1790608353712 (3 ms, the alarm), expiresAt = endedAt + 2 h |
| Race-1 stroke sent into race 2 | 409 "that stroke was for a different race" |
| Pace floor: first stroke hammered right after GO of race 2 | 429 "too fast, slow down a little" (41 attempts, first past GO refused) |
| Late joiner in race 2 | has a progress entry (races the next one) |

## 2. Browser + agent run with a network cut: `python3 scripts/live-run.py --blip`
Room 69Y7, 2026-09-28 about 15:13 UTC. Headless Chromium, audio stubbed and muted.
The kid's stroke sends were cut (`route.abort`) for 6 s starting at the first stroke of 水,
while the kid kept tracing. Printed output of that run:
- Server when the network came back: `charIndex 1, strokeIndex 0, charsDone 1, strokesDone 3, seq 3`
  (none of the 水 strokes had arrived; the phone had drawn ahead).
- The pad resynced to the room and the kid retraced. Final server progress:
  `charsDone 3, strokesDone 11, seq 11, finishedAt 1790608469787` (山 3 + 水 4 + 火 4 = 11 strokes).
- Kid screen: "You are number 1! You wrote 3 characters. 好棒!"; teacher board: "Mia 3 of 3 done, Done!".
- `phone_and_room_agree: true`. The agent (Robo) finished 3 of 3 with 2 mistakes.

## 3. Demo recording: `python3 scripts/live-run.py --record`
Room 875M. Full JSON: [`2026-09-28-live-run-record.json`](2026-09-28-live-run-record.json).
Outputs `docs/demo/trace-race-demo.mp4` (461,909 bytes, 29.6 s, 1.25x) and
`docs/demo/trace-race-demo.gif` (1,816,665 bytes, 820 px, 8 fps). Frames at 15%, 45% and 90%
were extracted and looked at: countdown with the board on "Ready, set...", Momo cheer next to
a live board, and the winners board next to "You are number 1!".

## Not verified live
- A real phone's touch screen (only headless Chromium mouse events).
- A full classroom of phones polling at once.
