# Live receipt, Trace Race (2026-09-28, final: round 4 plus the two confirmation one-liners)

- Live URL: https://trace-race.joyd-ai-2026.workers.dev (workers.dev only)
- Deployed commit: `751a7ca554e5d24265c7296caf3094ba0d9670dd` (branch `feat/trace-race`, clean tree, `npm run deploy`)
- Deployed version: `7fc83969-e497-4d82-ab14-a5e2c8e13d29`, 100% of traffic. Raw output: [`2026-09-28-wrangler-deployments-status.txt`](2026-09-28-wrangler-deployments-status.txt)
- Every raw JSON below carries the version and commit it ran against (`deployedVersion`/`deployedCommit`
  or `deployed_version`/`deployed_commit`) and its start and finish time. The stale-seat JSON is the
  exception: that script has no stamp, and it ran in the same batch as the gate.

## 1. API gate: `node scripts/live-gate.mjs`
Raw: [`2026-09-28-live-gate.json`](2026-09-28-live-gate.json), 2026-09-28T16:12:03.691Z to 16:12:34.876Z.
20 of 20 checks passed.

| Check | Result on the live site (from the JSON) |
|---|---|
| Home page, closed stroke proxy (hash = manifest, bad paths 400), licence | pass |
| `%E0` 400, 40,000-char body 413, 4,001-char paste 400 | pass, plain messages |
| Room 96MK: missing character noted; late joiner waits; retries are no-ops; mistake counts once | pass |
| **Race ended on the clock, nobody polling** | endsAt 1790611948136, endedAt 1790611948138 (2 ms), expiresAt = endedAt + 2 h |
| Race-1 stroke sent into race 2 | 409 |
| Pace floor: first stroke right after GO | 429 |
| **Pace boundary on the server clock** | stroke 2: last 429 at GO+494 ms, accepted at GO+530 ms (floor GO+500) |

## 1c. Normal race on this version: `python3 scripts/live-run.py`
Raw: [`2026-09-28-live-run-normal.json`](2026-09-28-live-run-normal.json) (room ZXYC). A browser kid traced 山 水 火 with real pointer
drags and the agent raced; the teacher's race screen (now rebuilt only on change) moved from the
race to "Winners!" and showed 1 Mia 3 of 3 done Done! 2 RoboAI 3 of 3 done, 2 oops Done!. `phone_and_room_agree: true`.

## 2. FULL outage, solo kid (round 4, version `25d11942`, commit `5d45fb6`): `python3 scripts/live-run.py --blip --cut hang --cut-scope all --cut-seconds 45 --no-agent`
Raw: [`2026-09-28-live-run-full-outage.json`](2026-09-28-live-run-full-outage.json) (room RKP5).
Every room request from the kid's phone (strokes AND polls) got no answer for 45 s, starting
at the first stroke of 水, while the kid kept tracing. No other racer, so nothing else moved the room.
- Room version at the cut: 6; at the end of the cut: 6 (the room did not change, so a
  conditional poll would say "unchanged"; the forced full read after the give-up is what resyncs).
- Requests left hanging by the phone: 11 (each abandoned at the 8 s deadline, then retried; the
  outage is longer than the 34.6 s give-up path).
- Server when the network came back: strokesDone 3 (none of the 水 strokes had landed).
- Phone right after: "Character 2 of 3 ... Oops, the internet hiccuped" (resynced to the room).
- Final: charsDone 3, strokesDone 11, seq 11; board "Mia 3 of 3 done"; `phone_and_room_agree: true`.

## 3. Stale seat, entered through the join link: `python3 scripts/stale-seat-check.py`
Raw: [`2026-09-28-live-stale-seat.json`](2026-09-28-live-stale-seat.json) (room RSVG, this version). Opened `#/join/RSVG` with a
stale seat, got "This room has ended.", tapped "Join again" on the same fragment, got the join
form with RSVG filled in; seat cleared. `pass: true`.

## Earlier runs kept for history
- [`2026-09-28-live-run-hang-cut.json`](2026-09-28-live-run-hang-cut.json): round 2, version `6e1f420e`, 14 s stroke-only hang (room U37B). Superseded by run 2 above.

## 4. Demo recording (round 1)
[`2026-09-28-live-run-record.json`](2026-09-28-live-run-record.json), room 875M, recorded on round-1 version `79ed1713`.
A normal race looks the same after rounds 2 to 4, so it was not re-recorded.

## Not verified live (B or C)
- One presence list for "Kids here" and Start (a kid unseen 46 s neither listed nor raced, 30 s both): `tests/race.test.ts`, B.
- The outbox skip and reset rules: `tests/client-net.test.ts`, B (the full-outage run above exercises them live).
- `AbortSignal.timeout` fallback for old Safari / Chrome: `tests/client-net.test.ts` with the global stubbed, B; no old device tried, C.
- The hiccup notice clearing after 3.5 s in every stage, and "Almost there" after an unreconciled give-up: `tests/route.test.ts`, B.
- A "Race again" error staying on the teacher's screen: source change only (the change key), B.
- The 45 s outage run above ran on version `25d11942`; the two one-liners since then touch the finish label and the teacher screen, not the resync path. B for this exact version.
- A real phone's touch screen; a full classroom of phones: C.
