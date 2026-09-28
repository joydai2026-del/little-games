# Missing Stroke 补一笔: build report (2026-09-28)

Evidence grades: **A** = seen live or run on the real surface this session, **B** = proven by
tests or read in source, not live, **C** = assumed.

## What shipped

| Item | Status | Grade | Evidence |
|---|---|---|---|
| Live site on workers.dev only | https://missing-stroke.joyd-ai-2026.workers.dev, final version `31eff58e-d242-485d-aa09-07267e1aeed7` (commit `ffe98f1`, own rate-limit bucket `namespace_id` 1051) | A | `npm run deploy` output; live gate receipt names this version |
| Feasibility: quiz ONLY the missing stroke | hanzi-writer 3.7.3 `quizStartStrokeNum` + `cancelQuiz()` after the one right stroke; later strokes drawn by our own layer (`getScalingTransform`). No custom matcher needed | A | source read (plan doc table); live run: backwards stroke wiggled, median of the missing stroke filled with ink, 4 of 4 moves |
| Hidden stroke per character | `hiddenStrokeFor(count, seed, index)`, seed drawn by the room at Start, stored in state | B | 3 reducer tests (range, determinism, spread over all 8 strokes); live gate shows `turn.hidden` in range |
| Right / wrong accounting, seq idempotency, race id | copied Trace Race shape; answers name `race`, `seq`, `turn` | A | live gate: retried wrong stroke counts once, earlier-race answer 409, answer after the race 409 |
| Fastest right stroke wins; same-ms tie shares | `turn.winners` | B (tie) / A (win) | reducer test for the tie; live gate: Ava wins, board shows it |
| Hint after N misses by level | `LEVELS` config, `hintMissesLeft` keeps misses across a rebuilt pad | B | 2 reducer tests; the hint flash itself is the library's `showHintAfterMisses` (not screenshotted) |
| Clock: close on time / all right / grace after first right, reveal, next, end | `advanceIfDue` loop + one alarm | A | live gate: with nobody polling, the room closed the character at exactly first-right + 6000 ms and ended at close + 3500 ms (`closedAt` and `endedAt` equal the expected ms) |
| Pace floor | right stroke sooner than 700 ms after open = 429 | A | live gate: right stroke 150 ms after GO got 429 |
| Late joiners watch, play next | frozen roster | A | live gate: 409 for Late Leo, not on the board, in race 2 |
| Class room: lobby, level picker, live board, reveal, winners | teacher screen | A | stills `docs/demo/missing-stroke-{lobby,board-live,board-reveal,winners}.png`, looked at |
| Kid pad on a phone (390 px) with real pointer drags | `scripts/live-run.py` | A | `docs/evidence/2026-09-28-live-run-record.json`: 0 console errors, backwards stroke wiggled, kid 3 of 3 right (won 1, the AI won 2) |
| Solo mode on one phone | same reducer in the browser | A | `docs/evidence/2026-09-28-live-run-solo.json`: 5 of 5 found, 0 console errors; still looked at |
| Agent API + `agent/play.mjs` | turn-aware `planStroke` / `waitFor` | A | live run: Robo (agent) joined and got 3 of 3 with one miss; live gate: two agents (Ava right, Bo wrong); agent-flow test end to end through the real router and DO |
| Stroke proxy with ALL mitigations | copied byte for byte (manifest, pin, 64 KB cap, schema, nosniff, licence) | A | live gate: 我 bytes match the manifest sha256; `..%2Fx`, two characters, and a no-data character all 400; licence served |
| Brand kit byte for byte, L4 header, plain header while live | `npm run check:brand` passes; `headerLinkOn` | A (brand check) / B (header guard tests) | |
| Demo recorded on the live site | mp4 1.0 MB, gif 3.6 MB (under 8 MB), recorded on version `71b4ed9b` (later versions changed nothing a viewer sees). In this take the AI won 2 of 3 (real result) | A | `docs/demo/`; frames at 12 s and 20 s looked at. The phone and board panels start a few seconds apart (two browser windows), so they are not frame-synced |
| mp4 user-attachments URL | pending, JJ adds (comment in README) | C | GitHub attachment upload is a browser step |

## Checks

- `npm test`: 69 vitest tests in 8 files + 4 node agent tests, all green (A).
- `npm run typecheck`, `check:xss`, `check:palette`, `check:brand`: all pass (A).
- Live gate: 21 of 21 checks pass on the final version, receipt `docs/evidence/2026-09-28-live-gate.json` (A).
- Solo run on the final version: 5 of 5, 0 console errors, `docs/evidence/2026-09-28-live-run-solo.json` (A).

## Codex review (3 rounds, read-only, adversarial)

| Round | Found | Done |
|---|---|---|
| 1 | 7 must-fix, 5 should-fix | Fixed 10: board gave away the stroke number before the reveal; overlapping polls could show an older state; a reloaded kid who was already right got a second live pad; the earned hint was lost on a rebuilt pad; changing characters per game skipped characters (now a stored list position); the 40-kid cap counted kids who had left; solo dropped playable characters past 60; an agent joining mid-race quit after watching; agent counts now come from the room; the alarm is rewritten only when its time changes. Not fixed, by design: answers are honor-based (same as Trace Race), no rate limit on the hash-checked stroke proxy (accepted in Trace Race's two-round scan). |
| 2 | 3 must-fix | All fixed: rooms saved before the list position existed; only the newest poll's answer is applied; solo keeps looking up characters until 60 are playable. |
| 3 | 3 must-fix (all small, in round-2 code) | All fixed: solo lookups bounded (120, each with a deadline) and overflow kept; a dropped poll no longer moves the clock offset. Stopped here per the stopping rule (findings shrinking, no reversals). |

Also from the coordinator: the rate-limit `namespace_id` was shared with Trace Race (1002); now 1051, id table in the README.

## What is B or C (not proven live)

- **Tie for fastest** (same server millisecond) is only unit-tested (B). Live it is rare by design.
- **Hint flash** after N misses: configured and counted (B); the flash is the library's own highlight and was not screenshotted.
- **Answer time** is measured when the room receives the answer, so a slow phone is a little slower (B, by design, noted in README Deferred).
- **Network hiccup resync** for the kid (a right stroke whose send never lands brings the pad back): code path copied in spirit from Trace Race, not exercised live here (B).
- **Fair play** is honor-based beyond the pace floor and the turn check, same as Trace Race (by design).
- **Real classroom use** (30 phones, iPads, small hands) not tried (C).
