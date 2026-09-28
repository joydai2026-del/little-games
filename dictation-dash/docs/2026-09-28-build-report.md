# Dictation Dash 听写赛跑: build report (2026-09-28, after review round 1)

**What this is:** the grades 3 to 5 listening game JJ approved today. Momo says a word, kids write
it from memory stroke by stroke, the fastest correct writer wins. Two levels on two big buttons
(Easy = faint outline, Hard = blank box). Review round 1 (Codex RETHINK, Claude FIX-FIRST) moved
every rule that matters onto the server.

Live: https://dictation-dash.joyd-ai-2026.workers.dev, version `65f7f2d1-a870-4e86-8a94-92c08b118786`
(commit `61e9cdd`), workers.dev only.

Grades: **A** = seen on the live deployed version above, in this session, with a stored receipt.
**B** = source, unit tests or a local run. **C** = assumed, not checked.

## Key takeaways

1. **The room is now the referee (A).** The room grades a stroke from the points the finger drew. A
   body that only says "correct" is refused. The live gate did both checks against the deployed
   version. Two agents wrote Easy and Hard rounds by sending real stroke points, and the headless
   kid wrote with pointer drags.
2. **The answer never reaches a kid (A for the checks run, B for the full proof).** Live gate:
   neither the lobby payload nor the mid-round payload names any word character or carries
   `strokeCounts`, on both levels. Unit tests cover the rest: no next stroke's shape, the
   teacher-only list, and closed words only.
3. **Speech cannot run up a bill (A for readback, B for fail-closed).** Every model attempt passes
   three budgets: a per-IP limiter, a per-room daily budget and a global daily budget. Each one
   fails closed. The live readback showed the counts. The missing-binding and throwing-limiter
   cases are unit-tested only, because the live deploy has every binding.

## Claims and grades

| Claim | Grade | Evidence |
|---|---|---|
| Strokes graded by the room from points; assertion-only refused | A | `docs/evidence/2026-09-28-live-gate.json` (41/41 on 65f7f2d1); tests: right, wrong, backwards, assertion-only |
| Kid payload has the audio handle and box count, never the word or stroke counts (lobby, mid-round, Easy and Hard) | A | Live gate checks |
| Hard never sends the outline; Easy sends it only after the word was heard | A (Hard null, Easy array) / B (timing) | Live gate; `tests/dash.test.ts` |
| The room owns the word clock: no stroke before the clip, late stroke refused, late word closed as skipped | A | Live gate (solo room, 15 s word left alone); also seen in the kid run: 朋友 (12 strokes) timed out at 40 s because the test driver takes about 1.5 s per stroke over the network |
| Every speech request must name the round | A | Live gate 400 |
| Room and global speech budgets count every attempt; readback | A (readback) / B (limits reached, fail-closed) | Live gate; `tests/tts.test.ts` |
| Room creation fails closed | B | `tests/room-do.test.ts` |
| Skipped word scores 0 (strokes taken back); ties share a place | B | `tests/dash.test.ts` |
| Hard stroke right only after the hint scores half, board shows "helped"; Easy full credit | B | `tests/dash.test.ts` (the kid run never needed a hint) |
| Two tabs, same seq, different points: second is a no-op | B | `tests/dash.test.ts`, `tests/room-do.test.ts` |
| New list resets the round cursor; words-per-round changes never skip or repeat | B | `tests/dash.test.ts` |
| Parser: headings skipped by shape and reported, zero-width stripped | A (live paste) / B | Live gate paste check; `tests/parse.test.ts` |
| Class lobby hides words until "Show words"; done screen has level, clock and list controls; Hard tapped in the real UI | A | `docs/demo/dictation-dash-teacher-levels.png`, `-winners-easy.png`, live run `hard_tapped_in_ui` |
| A crafted stroke cannot freeze the room | B | Cost test: a stroke that loops back to its centre grades in under 20 ms. The unguarded matcher did not finish that stroke in 180 s locally (stopped) |
| Word audio really plays on iPad, voice is right | C | Nothing may play sound here; nobody listened |
| Speech limit fits several classes on one school IP at once | C | 30 calls/min/IP; one call per NEW word per room |

## Known limits

- The agent must be given the list it "studied" (`--words`): the room never tells it the word.
- A word is closed the moment its clock runs out, even mid-stroke.
- Demo: in both rounds the scripted kid runs out of time on 朋友 (12 strokes, about 1.5 s per stroke
  over the network against a 40 s clock), so the demo shows the time-out path. A real kid gets the
  same 40 s; the teacher can raise it.
- Missing Stroke's matcher does not have the cost guards yet; the two files now differ only by those guards.

## Numbers

Tests: 70 vitest and 3 node:test, all passing. typecheck, check:xss, check:palette and check:brand
all pass. The live gate passes 41 of 41 checks. The demo was re-recorded on 65f7f2d1 and the gif is
under 8 MB.

## Summary of recommended action

1. Listen to five words on a real device (the voice is still grade C).
2. Run one class or parent-and-kid round on an iPad, Easy then Hard. Check that 40 s is enough for 12-stroke words.
3. Carry the matcher cost guards over to Missing Stroke so both games' matchers match again.
