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

**Verdict: YES (grade B, source read and a local and live run).** Read from the pinned file
(`dist/hanzi-writer.js` 3.7.3, SRI matched): `showOutline` / `showCharacter` only set layer opacity;
`strokeMatches` grades against the stroke medians either way (with no outline the FIRST stroke even
gets a looser distance threshold).

**Superseded by review round 1 (Codex + Claude, 2026-09-28).** A quiz on the phone needs the whole
character on the phone (the answer) and lets the phone decide what is right. The room now grades
every stroke from the drawn points with `src/shared/matcher.ts`, the same file as Missing Stroke (a
port of Hanzi Writer's MIT matcher), plus cost guards from Missing Stroke's review round 2. The phone
runs no matcher and loads no third-party script. Hard = the room never sends the outline.

## Feasibility check 2: speech and the client rules

Speech server pattern read from the Bilingual Vocab Game's `src/worker/tts.ts` (MeloTTS via the `AI`
binding, retry transient failures only, sniff the bytes). The client rules (one request per word, an
8 s START deadline then Try again / Skip, SILENCE WINS on a late `play()`, a mute button that cancels
the download, `?silent=1` for automation) were read in
`/Users/joyd/Bilingual Vocab Game Generator/src/client/tts.ts` (main branch) and
`src/client/games/sound-sprint.ts`, and **re-implemented here** in `src/client/speech.ts`: the pattern,
not the code.

| Vocab app | Dictation Dash |
|---|---|
| Cache API for clips | **Changed.** It does nothing on workers.dev (live: two requests, two MISSes, different bytes). One cached clip per unique room word, in the room's Durable Object storage, one synthesis in flight per word, up to `TTS_MAX_ATTEMPTS` model calls |
| Open `GET /api/tts?text=` with a daily quota | **Not copied.** Only a player of a running round, for a word they reached, with the round named (`/say?r=&w=`, `r` required) |
| Quota | **Every model call** must pass a per-IP limiter, a per-room daily budget and a global daily budget (`BudgetDO`); all FAIL CLOSED. Readback: `/api/rooms/:code/budget`, `/api/tts-budget` |
| Word clock on the phone | **Changed.** The room starts a word's clock when it first serves that player the clip, refuses strokes before it and after the deadline, and closes a late word as skipped |

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
