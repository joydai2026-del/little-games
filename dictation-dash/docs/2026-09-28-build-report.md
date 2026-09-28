# Dictation Dash 听写赛跑: build report (2026-09-28)

**What this is:** the first build of the grades 3 to 5 listening game JJ approved today. Momo says
a word, kids write it from memory stroke by stroke, the fastest correct writer wins. Two levels
on two big buttons (Easy = faint outline, Hard = blank box).

Live: https://dictation-dash.joyd-ai-2026.workers.dev (workers.dev only). Branch
`feat/dictation-dash`.

Evidence grades: **A** = seen live on the deployed site or read in source/tests this session.
**B** = follows from code and tests, not exercised live. **C** = assumed, not checked.

## Key takeaways

1. **Hard mode works with the library as is (A).** Hanzi Writer 3.7.3 grades strokes with the
   outline and the character hidden; read in its source and proven live (a real pointer drag
   landed in ink on a blank box). No own matcher was needed.
2. **Speech works live and costs one model call per word per room (A).** MeloTTS returns
   16-bit WAV (about 80 to 95 KB). The live gate saved clips to disk (never played) and showed
   the next listener gets the identical bytes from room storage.
3. **Two real bugs were caught by the live runs, not the unit tests, and fixed (A):**
   - The Cache API does nothing on workers.dev, so every "Hear it again" was a new paid call
     with different audio. Clips now live in the room's Durable Object storage, with one
     synthesis in flight per word.
   - The browser cached `/say?w=0` from round 1 and played it for round 2's word 0 (the kid
     would have heard the WRONG word). The round is now in the URL (`?r=&w=`), checked by the
     room, and clips are `no-store`.

## Claims and grades

| Claim | Grade | Evidence |
|---|---|---|
| Hanzi Writer quiz grades strokes with `showOutline:false, showCharacter:false` | A | Source read (`strokeMatches`, `getMatchData`, `startQuiz`); live Hard round written by the headless kid |
| Easy shows a faint outline, Hard a blank box, both obvious on the teacher screen and the pad | A | `docs/demo/dictation-dash-teacher-levels.png`, `-kid-easy.png`, `-kid-hard.png`, looked at |
| Speech returns real audio bytes, saved not played | A | `docs/evidence/2026-09-28-live-gate.json` (status 200, `audio/wav`, RIFF, sha256) |
| One model call per word per room; later listeners get the same clip | A | Live gate `cache: HIT` + identical sha256; unit test with 3 parallel requests = 1 call |
| Only players of the running round hear words, never ahead, never the teacher's board, never a stale round | A | Live gate 403/409 checks; unit tests |
| Two AI agents play Easy then Hard rounds to the end; a late joiner waits, then writes the next round | A | Live gate |
| A round ends on the clock with nobody polling (the alarm) | A | Live gate, `endedMinusEndsMs` |
| Solo practice: host writes and hears; joins refused | A | Live gate |
| Word fails to start: Try again / Skip shown, Try again recovers | A | Headless run (`hard_problem_text`, `hard_try_again_clicked`), `-kid-try-again.png` |
| Stroke proxy mitigations copied intact (pin, sha256 manifest, one code point, 64 KB cap, schema, nosniff, licence) | A | Live gate + `tests/strokes.test.ts` |
| Brand kit byte for byte, L4 header, plain header text for a writer mid-round | A (kit, check) / B (header in a live round) | `npm run check:brand` passes; header rule unit-tested, not screenshotted mid-round |
| 8 s start deadline, one request per word, SILENCE WINS on late play, mute cancels download | B | Code follows the vocab rules; silent mode never reaches `play()`, so real-speaker timing was not exercised (house rule: no sound on this machine) |
| Autoplay at the start of each word works on iPad Safari (unlocked by the first tap) | C | Same pattern as the vocab app; no iPad test this session |
| MeloTTS pronunciation is right for every grade 3 to 5 word | C | Only byte-level checks; nobody listened (house rule) |
| Class of 30 stays under the speech rate limit (30 misses/min/IP) | B | A class shares one school IP; misses are per NEW word per room, so 30 kids on 5 words = 5 misses. Many rooms in one school starting at once could hit it |

## Known limits (honest list)

- The phone knows the round's words (the writing box needs each character's stroke data), so a
  determined kid with developer tools could read them. Same for Trace Race. Grade A (by design).
- A kid who closes the tab within 45 s of Start stays in that round's roster until the clock
  ends it (Trace Race's presence rule, unchanged).
- Mistakes are counted and shown to nobody; ranking ignores them by JJ's "no penalty" rule.
- Not reviewed by Codex yet in this session (repo rule: Codex before JJ). Suggested next step.

## Numbers

- Tests: 63 vitest + 3 node:test, all green; typecheck, check:xss, check:palette, check:brand pass.
- Live gate: 32 of 32 checks pass.
- Demo: recorded live by `scripts/live-run.py --record`, gif under 8 MB.

## Master plan and north star

- **Master plan:** this game's plan is `docs/plans/2026-09-28-dictation-dash-plan.md`; the build
  bar in it is met except the Codex review. Paid tier is a flag only, as asked.
- **Ideal vs now:** ideal = a teacher runs a real Friday 听写 with it and kids ask for Hard.
  Now = works end to end on the live site with agents and a headless kid; not yet tried with a
  real class, a real iPad, or real ears on the voice.
- **Drift check:** everything built was in the approved WHAT; nothing was trimmed.

## Summary of recommended action

1. Listen to five words on a real device to judge the MeloTTS voice (grade C today).
2. Run one real class or a parent-and-kid solo round on an iPad, Easy then Hard.
3. Run the Codex review on `feat/dictation-dash` before merge.
