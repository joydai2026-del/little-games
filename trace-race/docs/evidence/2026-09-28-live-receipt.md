# Live receipt, Trace Race (2026-09-28, after review round 2 fixes)

- Live URL: https://trace-race.joyd-ai-2026.workers.dev (workers.dev only)
- Deployed commit: `307491a7da8f36872ae5e3dcc3a388b535d13edb` (branch `feat/trace-race`, clean tree, deployed with `npm run deploy`)
- Deployed version: `6e1f420e-d1e5-42fd-9dd6-cc5237b9f6f3`, created 2026-09-28T15:35:13.400Z, 100% of traffic.
  Raw output: [`2026-09-28-wrangler-deployments-status.txt`](2026-09-28-wrangler-deployments-status.txt)

## 1. API gate: `node scripts/live-gate.mjs`
Run 2026-09-28T15:35:29.396Z to 15:36:00.828Z against the version above. Raw JSON with every
status, body and timestamp: [`2026-09-28-live-gate.json`](2026-09-28-live-gate.json). 20 of 20 checks passed.

| Check | Result on the live site (from the JSON) |
|---|---|
| Home page | 200 |
| `/api/strokes/我` | 200, sha256 = manifest, `application/json`, `nosniff`, `public, max-age=2592000, immutable` |
| Proxy rejects `..%2Fx`, `我们`, `𠮷` | 400 each |
| `/licenses/ARPHICPL.TXT` | 200 |
| `/api/rooms/%E0` | 400 |
| 40,000-character body / 4,001-character paste | 413 / 400, plain messages |
| Room UYQR from `1. 山 shān / 2. 水 shuǐ / 3. 𠮷` | chars 山 水, missing 𠮷 |
| Late joiner strokes during the race | 409, not on the board; has progress in race 2 |
| Same stroke twice / same mistake twice | no-op / mistakes = 1 |
| **Race ended on the clock, nobody polling** | endsAt 1790609753995, endedAt 1790609753996 (1 ms), expiresAt = endedAt + 2 h |
| Race-1 stroke sent into race 2 | 409 "that stroke was for a different race" |
| Pace floor, first stroke right after GO | 429 |
| **Pace boundary on the server clock** | stroke 2: last 429 at GO+451 ms, accepted at GO+575 ms (floor GO+500); the exact 499/500 ms edge is pinned in `tests/race.test.ts` |

## 2. Browser + agent run with a HUNG network: `python3 scripts/live-run.py --blip --cut hang --cut-seconds 14`
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
- Resuming a saved seat by reopening the join link: unit-tested (`tests/route.test.ts`), B.
- Leaving a gone kid out of the next race: unit-tested (`tests/race.test.ts`), B.
