# Live receipt, Trace Race (2026-09-28, after review round 3 fixes)

- Live URL: https://trace-race.joyd-ai-2026.workers.dev (workers.dev only)
- Deployed commit: `4d7b75771df3e96f0272a1b29d90174f8e29b7a4` (branch `feat/trace-race`, clean tree, deployed with `npm run deploy`)
- Deployed version: `d59a95e2-1f55-4ca9-bf82-5b337dc57890`, 100% of traffic.
  Raw output: [`2026-09-28-wrangler-deployments-status.txt`](2026-09-28-wrangler-deployments-status.txt)

## 1. API gate: `node scripts/live-gate.mjs`
Run 2026-09-28T15:48:37.300Z to 15:49:08.546Z against the version above. Raw JSON with every
status, body and timestamp: [`2026-09-28-live-gate.json`](2026-09-28-live-gate.json). 20 of 20 checks passed.

| Check | Result on the live site (from the JSON) |
|---|---|
| Home page | 200 |
| `/api/strokes/我` | 200, sha256 = manifest, `application/json`, `nosniff`, `public, max-age=2592000, immutable` |
| Proxy rejects `..%2Fx`, `我们`, `𠮷` | 400 each |
| `/licenses/ARPHICPL.TXT` | 200 |
| `/api/rooms/%E0` | 400 |
| 40,000-character body / 4,001-character paste | 413 / 400, plain messages |
| Room VKG2 from `1. 山 shān / 2. 水 shuǐ / 3. 𠮷` | chars 山 水, missing 𠮷 |
| Late joiner strokes during the race | 409, not on the board; has progress in race 2 |
| Same stroke twice / same mistake twice | no-op / mistakes = 1 |
| **Race ended on the clock, nobody polling** | endsAt 1790610541760, endedAt 1790610541762 (2 ms), expiresAt = endedAt + 2 h |
| Race-1 stroke sent into race 2 | 409 "that stroke was for a different race" |
| Pace floor, first stroke right after GO | 429 |
| **Pace boundary on the server clock** | stroke 2: last 429 at GO+426 ms, accepted at GO+527 ms (floor GO+500); the exact 499/500 ms edge is pinned in `tests/race.test.ts` |

## 1b. Stale seat recovery (round 3): `python3 scripts/stale-seat-check.py`
Raw JSON: [`2026-09-28-live-stale-seat.json`](2026-09-28-live-stale-seat.json) (room TQHQ, on version `d59a95e2`).
A phone with a stale saved seat opens `#/join/TQHQ`, sees "This room has ended.", taps
"Join again" while the page is still on `#/join/TQHQ`, and gets the join form with TQHQ filled
in; the stale seat is gone from storage. `pass: true`.

## 2. Browser + agent run with a HUNG network (round 2, version `6e1f420e`): `python3 scripts/live-run.py --blip --cut hang --cut-seconds 14`
Raw JSON: [`2026-09-28-live-run-hang-cut.json`](2026-09-28-live-run-hang-cut.json) (room U37B).
Every stroke request from the kid's phone got NO answer for 14 s (never answered, not failed),
starting at the first stroke of 水, while the kid kept tracing.
- `requests_left_hanging: 2`: the phone abandoned the first attempt at its 8 s deadline and retried.
- Server when the network came back (14.0 s): `charIndex 1, strokeIndex 1, strokesDone 4, seq 4`.
- Final server progress: `charsDone 3, strokesDone 11, seq 11, finishedAt 1790609756917`,
  under 1 s after the network came back. Board: "Mia 3 of 3 done, Done!"; `phone_and_room_agree: true`.

Earlier fast-fail cut (round 1, `--cut abort`, 6 s, room 69Y7): also agreed, 11 strokes.
That run's output was printed, not saved as a file, so it is not re-graded here.

## 3. Demo recording (round 1): `python3 scripts/live-run.py --record`
Room 875M. Raw JSON: [`2026-09-28-live-run-record.json`](2026-09-28-live-run-record.json).
`docs/demo/trace-race-demo.mp4` (461,909 bytes, 29.6 s) and `.gif` (1,816,665 bytes). Recorded on
deployed version `79ed1713` (round 1). The round 2 changes are not visible in a normal run
(timeouts, resume, roster, ranking at zero progress), so the video was not re-recorded.

## Not verified live
- A real phone's touch screen (only headless Chromium mouse events).
- A full classroom of phones polling at once.
- Resuming a VALID saved seat by reopening the join link: unit-tested (`tests/route.test.ts`), B.
- The hiccup notice clearing after 3.5 s: unit-tested (`tests/route.test.ts`, `kidStatusText`), B.
- Leaving a gone kid out of the next race: unit-tested (`tests/race.test.ts`), B.
