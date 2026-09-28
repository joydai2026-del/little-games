# 猜猜我是谁 Stroke Reveal plan (2026-09-28)

Teacher sentence: "Momo draws a character one stroke at a time, and the first kid to tap the right word wins."

## Game loop
1. Teacher pastes a word list (messy is fine), picks the class level and words per round, taps "Make a room".
2. The parser (copied from tianzige-generator) keeps Chinese words in order, drops whole-word repeats, and skips headings BY SHAPE (第N课, a colon label over more Chinese lines), never by keyword. Everything skipped is shown to the teacher.
3. Kids join on phones with the code and a first name.
4. Teacher taps Start. 3-second countdown. For each word in the round: Momo draws its first character stroke by stroke on the big screen; each phone shows the same word cards (the right word plus up to 3 wrong ones from the list, never starting with the drawn character).
5. A kid taps a card. Right = points by how early; wrong = K-2 pause, or Grades 3-5 sit out that word.
6. The word closes on the clock or when every kid is done; the answer shows; the next word starts.
7. After the last word: Winners. "Play again" takes the next chunk of the list.

## Word timeline (pure, `src/shared/reveal.ts`)
| Moment | What happens |
|---|---|
| qStartAt | first stroke starts drawing |
| + firstStrokeShowMs + minRevealDelayMs = openAt | guessing opens; points count from here |
| + strokes x strokeMs | drawing complete |
| + holdAfterDrawnMs (6 s) = qEndsAt | guessing closes (sooner if everyone is done) |
| qClosedAt + answerShowMs (4 s) | next word starts, or the round is done |

One alarm per room: the next timeline moment, or room expiry. A late alarm catches up through several moments in one call.

## Rules
| Rule | Where |
|---|---|
| Points: 1000 at openAt, straight line down to 100 once drawn | `SCORING`, `pointsAt` |
| Wrong tap: lock (Grades 3-5) or a pause of max(2 s, 40% of the drawing), no points lost (K-2) | `LEVELS` |
| Private shuffled deck per room; each kid has their own card order; 4 cards minimum | `dealWords`, `buildQuestion` |
| AI ranked apart, never closes a word early | `standings(state, true)`, `everyoneDone` |
| Ties: equal points and right answers share a place | `standings` |
| Idempotency: round id + per-player seq; a repeated seq is a no-op | `submitGuess` |
| Late joiners: no score entry, watch, play next round | `join`, `startRound` |
| Hidden answer: kids never get the list, stroke counts, endsAt/expiresAt; `char`/`answer` only once the word closes | `publicView` |

## Config surface (`src/shared/config.ts`, validated, clamped)
| Setting | Default | Teacher can change |
|---|---|---|
| level | K-2 | yes |
| charsPerRound (words per round) | 5 | yes (1-20) |
| cardsPerQuestion | 4 | no |
| holdAfterDrawnMs / answerShowMs | 6000 / 4000 | no |
| strokeMs, lockOnWrong, wrongCooldownMs per level | K-2 1500/no/2000, 3-5 900/yes | no |
| maxKids, maxListWords, maxWordLen, roomTtlMinutes | 40, 60, 4, 120 | no |

## Agent API
Same HTTP API as the phones: create, join, state, `guess`, plus `GET /drawing` (the strokes on the big screen, never the character). `agent/play.mjs` matches drawn strokes against each card's first character and guesses after `--patience`.

## Deferred
Saved lists and paid modes, sound, remove-player and skip-word buttons.
