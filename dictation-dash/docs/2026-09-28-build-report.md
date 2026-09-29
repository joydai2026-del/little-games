# Dictation Dash 听写赛跑: build report (2026-09-28, after review round 4)

**What this is:** the grades 3 to 5 listening game JJ approved today. Momo says a word, kids write
it from memory stroke by stroke, the fastest correct writer wins. Two levels on two big buttons
(Easy = faint outline, Hard = blank box). Review round 1 (Codex RETHINK, Claude FIX-FIRST) moved
every rule that matters onto the server.

Live: https://dictation-dash.joyd-ai-2026.workers.dev, version `fb9a30d2-d68e-4c7d-8d17-fd7f315c38df`
(commit `8a7a165`), workers.dev only. The live gate passes 42 of 42 on fb9a30d2. The demo and the kid-run receipt are from eafdbf49: round 3 changed no screen.

Grades: **A** = seen on the live deployed version above, in this session, with a stored receipt.
**B** = source, unit tests or a local run. **C** = assumed, not checked.

## Key takeaways

1. **The room is the referee (A).** The room grades a stroke from the points the finger drew. A
   stroke that only says "correct" is refused. Live gate 42/42 on eafdbf49.
2. **Answer secrecy (B, with some A checks).** Round 1 claimed A here, and that was wrong: a kid
   could skip without hearing and read `closed[0].word`. The accepted strokes were also echoed as
   canonical shapes, which can be matched against public stroke data. Both are fixed:
   - A skip needs the word served first.
   - A closed word is named only once every kid has closed it.
   - Accepted strokes come back as the kid's own points.
   - Kid payloads carry no list report.

   Live checks (A): the lobby and mid-round payloads, the early-skip refusal and a null closed word
   while another kid is still on it. The full "learns nothing" proof is unit tests (B).
3. **Every word can be finished (A).** The clock is base + seconds per stroke, per level, bucketed.
   In the re-recorded run the kid wrote all 3 words in both rounds (round 1 had timed out on 朋友).
4. **Speech cannot run up a bill.** There are per-IP, per-room (race-free), global and per-IP
   daily budgets, all failing closed. The live readback is A; the limits and failures are B (tests).

## Claims and grades

| Claim | Grade | Evidence |
|---|---|---|
| Strokes graded by the room; assertion-only refused | A | `docs/evidence/2026-09-28-live-gate.json` (42/42, eafdbf49) |
| Kid payload (lobby, mid-round, Easy and Hard) names no word, no stroke count, no heading or left-out word | A for those payloads | live gate |
| No skip before hearing; a skipped word is not named while another kid is on it | A | live gate "sacrificial kid" check |
| A sacrificial kid learns nothing mid-word (all paths); accepted strokes echoed as own points | B | `tests/dash.test.ts` |
| Word clock by strokes, bucketed; a stroke after it is refused and the word closes as skipped | A (live solo room) / B (idiom 聚精会神, 43 strokes) | live gate; tests |
| Per-stroke gap 200 ms; the room stops grading a stroke after 6 tries (the hint shows after 4), per stroke so long idioms are not punished | B | tests |
| Room budget reserved without an await: two different new words, one slot, exactly one model call | B | `tests/tts.test.ts` |
| Per-IP daily cap below the global cap; readback | A (readback) / B (cap reached) | live gate; tests |
| Joins: 40/min per room and 40/min per IP (a class of 30 behind one school Wi-Fi gets in), checked before fullness (the 41st gets 429). 8/min per IP was tried in round 3 and locked a class out | B | `tests/room-do.test.ts` |
| Done-screen "Show words" works; pad shows "Checking..." while a stroke is graded | B | source; the demo run exercised the done screen but not the toggle |
| Demo: kid writes Easy then Hard (tapped in the real UI), Try again path | A | `docs/evidence/2026-09-28-live-run.json` on eafdbf49 |
| Crafted strokes cannot freeze the room | B | cost test |
| Voice sounds right; works on iPad | C | nobody listened; no iPad |

## Known limits

- The agent must be given the list it "studied" (`--words`): the room never tells it the word.
- A word is closed the moment its clock runs out, even mid-stroke.
- The word clock is bucketed to 20 s, so it still hints at the stroke count (to within 5 strokes
  on Hard). That is the trade-off for clocks that grow with the strokes.
- A kid whose device cannot reach the room at all for a word's sound (so the room never tried to
  serve it) cannot skip that word; the round clock still ends the round.
- Stroke counts: 朋 8, 友 4 in hanzi-writer-data 2.0.1 (`tests/fixtures/geom.json` and
  `src/worker/stroke-counts.json` agree), 12 for 朋友. Codex r2 read 3 for 友; the pinned file says 4.
- Missing Stroke's matcher does not have the cost guards yet; the two files now differ only by those guards.

## Numbers

Tests: 75 vitest and 3 node:test, all passing. typecheck, check:xss, check:palette and check:brand
all pass. The live gate passes 42 of 42 checks on eafdbf49. The demo was re-recorded on eafdbf49 and the gif
is under 8 MB.

## Summary of recommended action

1. Listen to five words on a real device (the voice is still grade C).
2. Run one class or parent-and-kid round on an iPad, Easy then Hard. Check that 40 s is enough for 12-stroke words.
3. Carry the matcher cost guards over to Missing Stroke so both games' matchers match again.
