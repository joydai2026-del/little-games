# Missing Stroke 补一笔: plan (2026-09-28)

Teacher sentence (from the idea board, approved by JJ today): "Momo forgot one stroke, and kids
race to draw it in the right spot."

## What (locked)

- A character from the teacher's pasted list appears in ink with exactly ONE stroke missing.
- The kid draws the missing stroke with a finger. Right: the stroke fills with ink and Momo cheers.
  Wrong: the pad wiggles; after N wrong tries (by level, config) the missing stroke flashes as a hint.
- The fastest right stroke wins the character. Rounds of N characters (config); time per character
  by level (config).
- Solo mode on one phone, plus a class race with a room code and a live board (Trace Race's room shape).
- 64 px tap targets, plain English, Avery brand kit byte for byte, L4 header "with 墨墨 Momo", header
  is plain text for a kid while a game is live.
- Agent-native: an AI player joins through the same HTTP API (`agent/play.mjs`).

## Feasibility check (the idea board's grade-C question)

Question: can hanzi-writer 3.7.3's quiz start at a given stroke, draw the other strokes as complete,
and quiz only stroke k?

Read from the pinned 3.7.3 source (the same bytes as the SRI hash
`sha384-xd6VpwMU5AxPFzG/nyhXrW70SSR2usiUNV8RrA0wlOjYlCrZyzZC6JiR/mT51pm2`):

| Need | Library | Evidence (3.7.3 source) |
|---|---|---|
| Start at stroke k | YES: `quiz({ quizStartStrokeNum: k })` | `Quiz.startQuiz`: `_currentStrokeIndex = min(fixIndex(quizStartStrokeNum), n - 1)` |
| Strokes 0..k-1 shown done | YES | `startQuiz` mutation: `character.main.strokes[i].opacity = i < startStrokeNum ? 1 : 0` |
| Strokes k+1..n shown done | NO | same mutation hides every stroke at or after k; no option shows them |
| Check ONLY stroke k | YES, with `cancelQuiz()` after the first right stroke | `endUserStroke` matches `strokes[_currentStrokeIndex]` only; `nextStroke` would move on to k+1 |
| Hint after N misses | YES: `showHintAfterMisses` highlights stroke k | `endUserStroke` -> `highlightStroke(currentStroke)` |
| Outline | must be OFF | the outline draws every stroke, including the missing one |
| Line a custom layer up with the writer | YES: public static `HanziWriter.getScalingTransform(w, h, padding)` | returns the exact `translate(...) scale(s, -s)` the writer uses |

Verdict: **partly yes, no custom matcher needed.** The quiz checks the single stroke (library
matcher, with its "a later stroke fits better" guard, which also rejects drawing over a stroke that
is already there). The one gap (strokes after k are hidden during the quiz) is filled by drawing
those strokes ourselves in an SVG layer under the writer, from the same proxied stroke JSON, with
the library's own scaling transform. Grade: A (read in source), confirmed live by the headless kid
run (real pointer drags: a backwards stroke is refused and wiggles, the median of the missing
stroke is accepted and fills with ink).

## HOW

HOW decision: rules engine shape
Options:
  A) copy Trace Race's per-kid race (each kid on their own character): simple, but "fastest right
     stroke wins the character" needs everyone on the same character at the same time.
  B) turn-based: one character open for everyone, closes on the clock / when all are right / a
     grace after the first right stroke, then a reveal, then the next one.
Preference: B, because the win condition is per character; the reveal is also where the teaching
happens (the missing stroke in pink on the projector).

- Pure reducer `src/shared/race.ts`: `startRace(seed)`, `submitStroke`, `advanceIfDue` (loops so
  one late alarm catches up), `standings`, `nextAlarmAt`, `hiddenStrokeFor`, `hintMissesLeft`.
- Room Durable Object copied from Trace Race: race id + per-racer `seq` idempotency, one alarm,
  presence rule ("Kids here" = the Start roster), pace floor (`minAnswerMs`), polling with back-off
  and resync, secrets outside state.
- Stroke proxy copied byte for byte with every mitigation (single allowlisted code point, pinned
  upstream, sha256 manifest, 64 KB cap, schema check, nosniff, licence served and credited).
- Solo mode runs the same reducer in the browser behind the same `Backend` interface.

## Parallel map

| Item | Parallel with | Depends on |
|---|---|---|
| Reducer + tests | proxy/DO copy | config + types |
| Room DO + Worker | reducer tests | reducer |
| Agent lib + tests | client | reducer shape |
| Client (pad, board, solo) | agent | reducer, tracer adapter |
| Deploy, live gate, headless run, demo | docs | all of the above |

## Config (never a literal in logic)

`src/shared/config.ts`: `LEVELS` (seconds per character, hint after N misses), `charsPerRound`,
`revealMs`, `graceAfterFirstRightMs`, `minAnswerMs`, polling, back-off, presence window, sizes.
`wrangler.jsonc`: create rate limit, stroke cache and upstream caps.

## Review round 1 (PR #17): what changed after the feasibility check

- **The room grades, not the phone.** The API takes the drawn POINTS, never a verdict; the room
  grades them with `src/shared/matcher.ts` (Hanzi Writer's matcher, ported, same thresholds; tracing
  any stroke already on screen is a miss). Solo mode runs the same matcher on the phone.
- **The answer never reaches a phone.** Phones get the other strokes' shapes, unlabelled; the missing
  stroke's shape only after the close, once that kid got it right, or as that kid's earned hint.
  So the phone no longer loads Hanzi Writer at all: the feasibility finding above still holds, but
  the library quiz is no longer used.
- **One-stroke characters are skipped** (`minStrokesToPlay: 2`) with a teacher note.
- **Joins are limited** per room (`joinsPerRoomPerWindow`) and per IP (`JOIN_LIMITER`).
- **Header is plain text for any kid while a game is live.**
- **Class board chips**: finished characters only; the current and upcoming ones show "?".

Later, not now: a per-level option `laterStrokes: 'hide'` for grades 4-5 (show only the strokes
BEFORE the missing one, so older kids must also know the order).
