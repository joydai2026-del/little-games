# Stroke Reveal build report (2026-09-28)

**What is this report?** The build of 猜猜我是谁 Stroke Reveal, the Avery Studio reading game JJ approved today: what shipped, what was proven on the live site, and what is still assumed.

**Key takeaways**
1. Live and playable: https://stroke-reveal.joyd-ai-2026.workers.dev (Worker version `5b355383-7077-47f9-a422-cf1b82edbd4e`, commit `e9fc5fe`).
2. Proven on the live site: the API gate passed 23 of 23, and a headless teacher + scripted-reader kid + AI agent run played a full round to Winners and recorded the demo.
3. Not yet proven: real phones and iPads, a full class on school Wi-Fi, a Codex review, and the mp4 upload for the README.

**Summary of recommended action**
- Re-run the review panel on the fixes before JJ plays it.
- Upload `docs/demo/stroke-reveal-demo.mp4` through GitHub's attachment box and replace the two `pending` comments.
- Try one round on a real phone plus the classroom screen.

## Evidence grades
A = seen on the live site with a saved receipt. B = proven by tests or indirectly. C = assumed, not verified.

| Claim | Grade | Evidence |
|---|---|---|
| Site, stroke proxy (manifest hash for 我, rejects traversal / two chars / no-data char), licence served | A | `docs/evidence/2026-09-28-live-gate.json` |
| Messy paste: heading 第一课 skipped and reported, 𠮷野 listed as not drawable | A | live gate + lobby still |
| A kid's payload carries no list, no other words from the list (6 playable, 0 found outside the 4 cards), no stroke count, no `endsAt`/`expiresAt`, no right card while a word is open | A | live gate |
| Card order is shuffled independently for each phone (round 2: big screen 山/口/大人/学校, Robo 学校/口/山/大人, Leo 学校/口/山/大人; the two phones matched each other by chance, 1 in 24, and both differ from the big screen) | A for differing from the big screen; B for independence per phone (`tests/reveal.test.ts`) | live gate `round2CardOrders` |
| The answer cannot be derived from the payload (pasted order, first card, big-screen position all at chance or below over 300 rooms) | B | `tests/reveal.test.ts` "the old attack fails" (reducer, not live) |
| Minimum reveal: a tap 250 ms after the drawing starts is refused (status 409); guessing opens 1400 ms after the start | A | live gate |
| An agent sees exactly one matching card after the reveal and scores 732 points, tapping 268 ms after guessing opened (2 strokes x 900 ms) | A | live gate (numbers quoted from the receipt) |
| Retried guess (same seq) changes nothing | A | live gate |
| Guess before drawing starts refused; late joiner waits, then plays round 2 among the kids | A | live gate |
| Word closes on the clock by the alarm with nobody polling (`closedAt === endsAt`), round ends after the answer shows (`endedAt === nextAt`) | A | live gate |
| AI players ranked in their own line; no AI in the kids' places | A | live gate + winners still |
| Round-1 guess refused in round 2; Grades 3-5 wrong tap locks the player out of that word | A | live gate |
| Full round in a browser: the big screen draws in step, a scripted-reader kid taps 3 words right (one wrong tap on word 2 first, K-2 pause shown), the AI agent plays, Winners, kid sees their place | A for the flow; the kid is a script matching stroke data from its own seat, so it does NOT show a child can read the drawing | `docs/evidence/2026-09-28-live-run-record.json`, stills in `docs/demo/` (looked at) |
| hanzi-writer 3.7.3 loads with the pinned SRI hash (it drew in live headless Chromium, so the hash matched) | A | board-live still |
| Brand kit and L4 header; header plain text for a kid mid-round | A | `npm run check:brand`; the review panel checked the header live |
| Blind tapping over 4 cards scores below a mid-reveal reader, 1 to 20 strokes, both levels (and the test fails with a flat 2 s K-2 pause) | B | `tests/reveal.test.ts` |
| Scoring curve, K-2 pause, ties share a place, late-alarm catch-up, deck deals without repeats, two tabs on one seat apply exactly one result, a stale poll never replaces newer state | B | `tests/reveal.test.ts`, `tests/route.test.ts` |
| Parser, stroke proxy mitigations, agent end to end | B | `tests/parse.test.ts`, `tests/strokes.test.ts`, `tests/agent-flow.test.ts` |
| Totals | B | vitest 78 passed, node agent tests 4 passed; typecheck, check:xss, check:palette, check:brand clean |
| Real phones, iPads, Safari animation timing (is 800 ms enough for stroke 1 on a slow iPad?) | C | only headless Chromium at 390x844 and 1100x900 |
| A class of 20-40 kids on school Wi-Fi | C | not load tested |
| Kids find it fun and readable | C | no kid has played it |

## Fixed after the review panel (both reviewers FIX-FIRST)
1. **The answer was predictable** (critical, proven live on room JS5D): kids received the whole list in order and rounds played it in order. Now: a private shuffled deck, per-phone card order, and no list, stroke counts or leaking timings in a kid's payload.
2. **Minimum reveal**: taps open only after stroke 1 is visible plus 600 ms; points count from then; K-2 wrong taps cost no points, only a pause; at least 4 cards. The pause is max(2 s, 40% of the drawing): the coordinator's flat 2 s default failed the blind-tap test on 5+ stroke characters, so the floor stays 2 s and it stretches on long characters.
3. AI players ranked apart and never close a word early (so in the demo the AI got fewer words: the kid closed them first).
4. A forced poll can no longer roll a phone back to older state.
5. "Change the list" is a 64 px target with a focus ring.
6. This report now quotes the regenerated receipt; the two overstated A rows are regraded.
7. Two tabs on one seat: tested; trailing blank line removed.

## Found and fixed during the live runs
1. **A poll could eat a tap.** The kid's card buttons were rebuilt on every state change, so a click landing during a poll hit a detached button (the recorder crashed on exactly this). Buttons are now built once per word and only restyled.
2. **Strike-through changed the word.** A line through a tried 人 reads as 大. Tried cards now fade and get a corner ✕ badge instead.
3. The big screen kept the lobby's scroll position; it now starts at the top, and the pad size accounts for the header.

## Design notes
- Agents "see" through `/drawing`, the same strokes the class sees, and match them against public stroke data. With `--patience 0` an agent is faster than any kid, which is why AI players are ranked in their own line.
- Ratelimit namespace `1041` for room creation is unique (the review panel checked); it found `missing-stroke` reusing Trace Race's 1002, which belongs to that PR.
- Momo's reactions are CSS only on the one official PNG (tilt while drawing, bounce on the answer, pop on the "好棒!" cheer), always square with `object-fit: contain`.

## Master plan and north star
- Plan section: Avery Classroom Games, a new standalone reading game beside Trace Race (brief: `docs/avery/AVERY-CLASSROOM-GAMES-PICKUP.md`). Done: the whole loop, agent path, live deploy, demo. Deferred: saved lists and paid modes, sound, teacher remove-player and skip-word.
- Ideal vs now: the ideal is a teacher running it on the projector with a full class laughing at Momo's half-drawn characters. Today it works end to end on the live site with one browser kid and one AI; the gap is real devices, a real class, and review.
- Drift check: a real customer (a K-5 immersion teacher) needs this as approved on the idea board; nothing here is pre-customer scaffolding beyond the agent API, which the repo rule requires.
