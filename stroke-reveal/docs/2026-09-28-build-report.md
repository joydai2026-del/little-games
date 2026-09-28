# Stroke Reveal build report (2026-09-28)

**What is this report?** The build of 猜猜我是谁 Stroke Reveal, the Avery Studio reading game JJ approved today: what shipped, what was proven on the live site, and what is still assumed.

**Key takeaways**
1. Live and playable: https://stroke-reveal.joyd-ai-2026.workers.dev (Worker version `a6a38409-1f13-48ec-b073-c4190796ca70`).
2. Proven on the live site: the API gate passed 22 of 22, and a headless teacher + kid + AI agent run played a full round to Winners and recorded the demo.
3. Not yet proven: real phones and iPads, a full class on school Wi-Fi, a Codex review, and the mp4 upload for the README.

**Summary of recommended action**
- Run the Codex review on `feat/stroke-reveal` before JJ plays it.
- Upload `docs/demo/stroke-reveal-demo.mp4` through GitHub's attachment box and replace the two `pending` comments.
- Try one round on a real phone plus the classroom screen.

## Evidence grades
A = seen on the live site with a saved receipt. B = proven by tests or indirectly. C = assumed, not verified.

| Claim | Grade | Evidence |
|---|---|---|
| Site, stroke proxy (manifest hash for 我, rejects traversal / two chars / no-data char), licence served | A | `docs/evidence/2026-09-28-live-gate.json` |
| Messy paste: heading 第一课 skipped and reported, 𠮷野 listed as not drawable | A | live gate + lobby still |
| Kids never receive the drawn character or right card while a word is open; the teacher does | A | live gate (kid state `char: null, answer: null`, no `questions` key) |
| `/drawing` returns only the strokes on the screen and never names the character | A | live gate |
| An agent sees exactly one matching card and guesses early; points above the 100 floor (768 at 697 ms into a 2.7 s drawing) | A | live gate |
| Retried guess (same seq) changes nothing | A | live gate (same version, same points) |
| Guess before drawing starts refused; late joiner waits, then plays round 2 | A | live gate |
| Word closes on the clock by the alarm with nobody polling (`closedAt === endsAt`), round ends after the answer shows (`endedAt === nextAt`) | A | live gate |
| Round-1 guess refused in round 2; Grades 3-5 wrong tap locks the kid out of that word | A | live gate |
| Full round in a browser: teacher big screen draws in step, kid taps 3 words right (one wrong tap first on word 2, K-2 pause shown), AI agent 3 right, Winners board, kid sees "You are number 1!" | A | `docs/evidence/2026-09-28-live-run-record.json`, stills in `docs/demo/` (looked at) |
| hanzi-writer 3.7.3 loads with the pinned SRI hash (it drew in live headless Chromium, so the hash matched) | A | board-live still |
| Brand: theme.css and Momo PNGs byte-identical to `avery-brand/`, L4 header "with 墨墨 Momo", header plain text for a kid mid-round | A (kit, header) / B (plain-text header: unit test) | `npm run check:brand`, `tests/header-guard.test.ts` |
| Scoring curve, K-2 pause, ties share a place, late-alarm catch-up, card building (wrong cards never share the drawn character), hidden answer | B | `tests/reveal.test.ts` (18 tests) |
| Parser: skip-and-report headings by shape, never by keyword; whole-word dedupe; overflow listed | B | `tests/parse.test.ts` (tianzige paste fixtures) |
| Stroke proxy mitigations (size cap, hash mismatch 502, shape check, no network on a rejected path) | B | `tests/strokes.test.ts` |
| Agent end to end through the real router and Durable Object | B | `tests/agent-flow.test.ts` |
| Totals | B | vitest 70 passed, node agent tests 4 passed; typecheck, check:xss, check:palette, check:brand all clean |
| Real phones, iPads, Safari animation timing | C | only headless Chromium at 390x844 and 1100x900 |
| A class of 20-40 kids on school Wi-Fi (poll every 0.7 s while playing) | C | not load tested |
| Kids find it fun and readable | C | no kid has played it |
| Codex review | C | not run in this build (repo rule: before JJ sees it) |

## Found and fixed during the live runs
1. **A poll could eat a tap.** The kid's card buttons were rebuilt on every state change, so a click landing during a poll hit a detached button (the recorder crashed on exactly this). Buttons are now built once per word and only restyled.
2. **Strike-through changed the word.** A line through a tried 人 reads as 大. Tried cards now fade and get a corner ✕ badge instead.
3. The big screen kept the lobby's scroll position; it now starts at the top, and the pad size accounts for the header.

## Design notes
- The room hides the answer from kids, so an agent cannot read it from the state. Agents "see" through `/drawing`, the same strokes the class sees, and match them against public stroke data. With `--patience 0` an agent is faster than any kid; the default is 0.4 and the demo uses 0.7.
- Ratelimit namespace `1041` for room creation (Trace Race uses 1002). If another new game picks the same id they share a counter; harmless but worth a glance at merge time.
- Momo's reactions are CSS only on the one official PNG (tilt while drawing, bounce on the answer, pop on the "好棒!" cheer), always square with `object-fit: contain`.

## Master plan and north star
- Plan section: Avery Classroom Games, a new standalone reading game beside Trace Race (brief: `docs/avery/AVERY-CLASSROOM-GAMES-PICKUP.md`). Done: the whole loop, agent path, live deploy, demo. Deferred: saved lists and paid modes, sound, teacher remove-player and skip-word.
- Ideal vs now: the ideal is a teacher running it on the projector with a full class laughing at Momo's half-drawn characters. Today it works end to end on the live site with one browser kid and one AI; the gap is real devices, a real class, and review.
- Drift check: a real customer (a K-5 immersion teacher) needs this as approved on the idea board; nothing here is pre-customer scaffolding beyond the agent API, which the repo rule requires.
