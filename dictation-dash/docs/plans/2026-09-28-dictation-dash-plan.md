# Dictation Dash 听写赛跑: plan (2026-09-28)

**Approved WHAT (JJ, idea board, 2026-09-28):** a listening game for grades 3 to 5. "Momo says a
word, kids write it from memory, and the fastest correct writer wins." Keep it simple. The
difficulty levels must be obvious on screen. Paid tier later (it uses speech).

## Scope

| In | Out (not asked for) |
|---|---|
| Hear the word (Workers AI Chinese TTS), "Hear it again" with a config replay limit | Pinyin or English hints on screen |
| One blank 田字格 per character, written stroke by stroke with a finger | Handwriting recognition beyond per-stroke checking |
| Right strokes stay in ink, a wrong stroke wiggles, nothing else | Mistake penalties, lives, streaks |
| Two levels on two big buttons: Easy (faint outline) / Hard (blank box) | More levels |
| Rounds of N words (config), time per word (config) | Custom per-word timers |
| Solo practice + class race with a room code (Trace Race's room shape) | Accounts, saved progress |
| Bean jumps ahead on the class board per finished word | |
| Agent API + `agent/play.mjs` | |
| `PRODUCT.paidLater` flag | Paywall code |

## Feasibility check 1: can hanzi-writer 3.7.3 grade strokes with NO outline? (was grade C)

**Verdict: YES. Hard = `showOutline: false`, `showCharacter: false`, same quiz. Grade A.**

Read from the pinned file (`dist/hanzi-writer.js` 3.7.3; the `.min.js` SRI hash matched the one
Trace Race ships, `sha384-xd6VpwMU...51pm2`):

- `showOutline` / `showCharacter` only set the opacity of the `outline` and `main` render layers
  in the initial render state. Nothing in the quiz path reads them to decide whether to grade.
- `Quiz.endUserStroke()` always calls `strokeMatches(userStroke, character, strokeIndex, {...})`,
  which compares the drawn points with the character's stroke data (`stroke.points`, the medians)
  for distance, start and end, direction, Frechet shape fit and length.
- The only use of the outline in grading: `isOutlineVisible` is passed in, and
  `getMatchData` uses `distMod = isOutlineVisible || strokeNum > 0 ? 0.5 : 1`. With the outline
  hidden, the FIRST stroke of a character gets a looser distance threshold (it has nothing to
  line up with). Every later stroke is graded exactly as with the outline.
- `startQuiz` sets the `main` layer to opacity 1 with every stroke at 0, and `nextStroke()`
  fades each accepted stroke in, so right strokes appear in ink even with `showCharacter: false`.

Live proof: the headless kid run wrote every word of the Hard round on the live site with real
pointer drags into a blank box (`docs/demo/dictation-dash-kid-hard.png` shows the first stroke of
上 in ink on a blank 田字格; `docs/evidence/2026-09-28-live-run.json`, `hard_state`).

No own median matcher was needed.

## Feasibility check 2: speech (Workers AI) and the client rules

Read from the Bilingual Vocab Game (`src/worker/tts.ts`, `src/client/tts.ts`,
`src/client/games/sound-sprint.ts`) and copied as a pattern, not code:

| Vocab app rule | Dictation Dash |
|---|---|
| MeloTTS via the `AI` binding, `{ prompt, lang: 'zh' }`, retry transient failures only, sniff the bytes (it returns WAV, docs say MP3) | Same (`src/worker/tts.ts`). Live: 16-bit WAV, about 80 to 95 KB per word |
| Cache the clip (Cache API) | **Changed.** Live check showed the Cache API does nothing on workers.dev: two requests for one word both came back MISS with different bytes. Clips are kept in the room's Durable Object storage, keyed by the word, with one in-flight synthesis per word. A class hearing a word makes one model call |
| Open `GET /api/tts?text=` guarded by a daily quota | **Not copied.** No open speech route: only a player of a running round, for a word they have reached (`/say?r=&w=`). Cache misses rate-limited per IP (`TTS_LIMITER`) |
| One request per word (a second tap joins the in-flight download) | Same (`src/client/speech.ts`) |
| 8 s START deadline, then Try again / Skip | Same (`GAME.speakTimeoutMs`), the word clock only starts once the word played |
| SILENCE WINS on a late `play()` | Same three-step rule, written in the file so a review cannot flip it |
| Mute button, memory first then storage | Same, on the kid's pad; muting cancels the playing and the downloading word |
| `?silent=1` for automation: never call `play()` | Same, and the clip is still downloaded so a silent run proves real bytes came back |

## Build map (what ran in parallel)

| Item | Depends on | Parallel with |
|---|---|---|
| Feasibility reads (hanzi-writer source, vocab TTS) | nothing | worktree + scaffold copy |
| Pure reducer `dash.ts` + `word-audio.ts` + tests | config/types | Worker (`room-do`, `tts`, proxy copy) |
| Client screens | reducer types | agent lib |
| Deploy + live gate | tests green | README / plan / report drafting |
| Headless kid run + demo | deploy | docs |

## Done bar

Scripts `dev/build/test/typecheck/check:xss/check:palette/check:brand/deploy`; tests green; live
gate (room, speech bytes saved never played, two agents, Easy and Hard rounds, clock end); a
headless silent kid run with pointer drags; 3+ stills looked at; demo mp4 + gif under 8 MB
recorded by script; READMEs; draft PR.
