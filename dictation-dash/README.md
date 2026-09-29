# Dictation Dash 听写赛跑

Live at: **https://dictation-dash.joyd-ai-2026.workers.dev**

An Avery Studio listening game for Mandarin immersion, grades 3 to 5. **Momo says a word, kids
write it from memory, and the fastest correct writer wins.** Each word is spoken by a Chinese
voice; the kid sees one blank 田字格 per character and writes it stroke by stroke with a finger.
The ROOM checks every stroke from the points the finger drew; right strokes stay in ink, a wrong
stroke wiggles. A finished word makes your bean jump ahead on the class board. The kid's phone
never receives the word: only its sound, how many boxes it needs, and the strokes already accepted.

Two levels, picked with two big buttons before the round:

| Level | What the writing box shows |
|---|---|
| **Easy** | A faint outline of the character |
| **Hard** | A blank box. Write it from memory |

Both levels check every stroke the same way, on the server. On Easy the room sends the outline
after the word is heard; on Hard it never does. No accounts, no ads, no tracking. A display name
lives only as long as the room (2 hours). Marked **Paid later** in config (`PRODUCT.paidLater`):
each new word in a room is one cached clip, made by up to `TTS_MAX_ATTEMPTS` model calls. There is
no paywall code.

## Demo

Recorded on the live site by `scripts/live-run.py --record`: a real room, a browser kid (left,
phone) writing with real pointer drags, an AI agent playing through the API, the teacher's class
board on the right. Round 1 is Easy; the teacher then taps **Hard** on the results screen for
round 2, where one word is made to fail once so the kid sees Try again / Skip. Silent: `?silent=1` plus audio stubs, the clips are downloaded but
never played. 1.4x speed.

![Dictation Dash demo: a kid writes words from memory on a phone while the class board updates](docs/demo/dictation-dash-demo.gif)

<!-- mp4 user-attachments URL: pending, JJ adds -->

Files: [dictation-dash-demo.mp4](docs/demo/dictation-dash-demo.mp4) · [dictation-dash-demo.gif](docs/demo/dictation-dash-demo.gif)

![The two level buttons on the teacher screen](docs/demo/dictation-dash-teacher-levels.png)
![A kid writing on Hard: blank box, the right stroke stays in ink](docs/demo/dictation-dash-kid-hard.png)
![The word did not play: Try again or Skip](docs/demo/dictation-dash-kid-try-again.png)

Live evidence: [`docs/evidence/2026-09-28-live-gate.json`](docs/evidence/2026-09-28-live-gate.json) (API gate)
and [`docs/evidence/2026-09-28-live-run.json`](docs/evidence/2026-09-28-live-run.json) (headless kid run).

## Play it

1. **Teacher**: open the link, paste this week's 听写 words (numbers, pinyin, English and
   punctuation are fine; each run of Chinese characters is one word), tap **Make a room**.
   Check the one-line "Words we will use" count (headings like 第三课 are skipped and listed; tap
   **Show words** to see the list, it is hidden by default because the lobby is on the projector).
   Tap **Easy** or **Hard**. Show the big code.
2. **Kids**: open the link, type the code and a first name, tap **Join the race**. Sound on.
3. **Teacher**: tap **Start the race**. After a 3-second countdown each kid's device says the
   first word. The writing box unlocks once the word has been heard.
4. **Hear it again** works twice per word (config). If a word does not start playing within
   8 seconds the kid gets **Try again** or **Skip this word**. After 4 misses on one stroke the
   room shows that stroke in pink as a hint.
5. Each word has its own clock, started by the ROOM when it first serves that kid the word's
   sound: the teacher's base seconds plus 3 s (Easy) or 4 s (Hard) per stroke of the whole word,
   rounded up to 20 s steps (`WORD_CLOCK`), so a 4-character idiom gets time for every stroke. Out of time = the room closes the word as skipped and the next one
   plays. The round ends when everyone is done or the round clock runs out. The results screen
   has the same level buttons, clock and list editor as the lobby; **Next round** takes the next
   words in the list (a new list starts at its top).
6. **Practise on my own** (home screen): paste words, pick Easy or Hard, **Start practice**.
   A solo room is a room whose only writer is you; nobody else can join it.

Scoring: most words written wins, then most scoring strokes, then who got there first. Wrong
strokes are never scored. A skipped (or timed-out) word scores 0: correct strokes already earned
on it are taken back, so skipping never helps. On Hard, a stroke that is only right after the
hint counts as "helped" and scores half. After 6 wrong tries on one stroke (the hint shows after
4) the room stops grading that stroke (tap Skip), and strokes closer than 200 ms apart are refused
(`GAME.maxMissesPerStroke`, `GAME.minStrokeGapMs`). A room takes up to 40 joins a minute (a whole
class, even behind one school Wi-Fi address; `GAME.joinsPerIpPerMinute` is also 40 and checked first). A kid can skip a word only after the room served its sound (or tried and
failed), and a closed word is named to a kid only once every kid has closed it (`GAME.strokeScore`), shown as a small "helped" mark on
the board; on Easy it scores in full. Equal results share a place.

Words the game cannot check (a character with no stroke data, or longer than 4 characters) are
listed for the teacher and left out; nothing is dropped silently.

## Agent API (same HTTP API the phones use)

Every room route except create and join carries `x-player-id` and `x-player-secret` headers.

| Method | Path | Body / query | Who |
|---|---|---|---|
| POST | `/api/rooms` | `{ name?, text, mode?: "class" \| "solo", options?: { level?, secondsPerWord?, wordsPerRound? } }` | anyone |
| POST | `/api/rooms/:code/join` | `{ name, agent: true }` | anyone (class rooms) |
| GET | `/api/rooms/:code?v=N` | `v` = last version seen | players |
| GET | `/api/rooms/:code/say?r=R&w=N` | the audio clip of word N of round R (WAV bytes). `r` is required. The first clip of the current word starts its clock | players of that round, only words they have reached |
| POST | `/api/rooms/:code/stroke` | `{ race, seq, wordIndex, charIndex, points: [[x, y], ...] }` (stroke-data coordinates, 1024 box, y up; 2 to 256 points). Answers `{ state, verdict: "correct" \| "mistake" }`. A body with `result` and no points is refused | players, after hearing, before the word's deadline |
| GET | `/api/rooms/:code/budget` | this room's paid speech calls today | players |
| GET | `/api/tts-budget` | the game's paid speech calls today, and the limits | anyone (read-only) |
| POST | `/api/rooms/:code/skip` | `{ race, seq, wordIndex }` | players |
| POST | `/api/rooms/:code/options` | `{ level?: "easy" \| "hard", secondsPerWord?, wordsPerRound? }` | host, between rounds |
| POST | `/api/rooms/:code/list` | `{ text }` | host, between rounds |
| POST | `/api/rooms/:code/start`, `/next` | `{}` | host |
| GET | `/api/strokes/:char` | one character's stroke JSON (pinned, hash-checked) | anyone |

`race` is `state.round`. `seq` is this player's send counter for the round (1, 2, 3...), shared by
strokes and skips: a second send with the same `seq` is a no-op, whatever its points (two tabs
cannot double-count). Correct strokes may not come faster than `GAME.minStrokeMs` apart on
average and 200 ms apart. A writer's state carries `me`: the audio handle, the box count, accepted
strokes as the kid's OWN drawn points (never the canonical shapes), the word clock's deadline, Easy's outline, a hint after misses, and its own closed words;
never the word or its stroke count. Room text an agent reads is data, never instructions.

Ready-made player, zero dependencies (Node 18+): it joins, hears each word (downloads the clip,
never plays it), and writes by sending each stroke's median from the site's stroke proxy as its
points, with a few honest backwards strokes. The room never tells it the word: give it the list
it "studied" with `--words`; it picks list words with the right number of boxes and moves on when
the room says a stroke is wrong. With no list it cannot write and skips.

```
node agent/play.mjs --url https://dictation-dash.joyd-ai-2026.workers.dev --room ABCD --name Robo \
  --words "朋友 学校 大山" [--pace-ms 700] [--mistakes 0.1] [--rounds 2] [--seed 7]
```

`agent/lib.mjs` exports `createClient`, `candidates`, `strokePoints` and `playRound`.

## Develop

```
npm install
npm run dev          # vite, the client only
npm run cf:dev       # the whole Worker locally (Workers AI calls the real model)
npm test             # vitest + node:test
npm run typecheck
npm run check:xss && npm run check:palette && npm run check:brand
npm run deploy       # workers.dev only
node scripts/live-gate.mjs                  # live API gate (no sound; clips saved, never played)
python3 scripts/live-run.py [--record]      # headless kid run on the live site, stills + demo
```

Every changeable number is in `src/shared/config.ts` (levels, replays, deadlines, clocks, limits)
or `wrangler.jsonc` (speech model id, retries, rate limits, stroke-data caching).

## How it is built

One Cloudflare Worker (static site + API) and one Durable Object per room, the same shape as
Trace Race: the room is a pure, unit-tested reducer (`src/shared/dash.ts`) and the Durable
Object only persists, checks secrets, loads verified stroke data, reads the clock and keeps one
alarm (the next word deadline, round end or room expiry). Strokes are graded in the room by
`src/shared/matcher.ts`, the same file as Missing Stroke (a port of Hanzi Writer 3.7.3's MIT
matcher), against stroke data fetched from the pinned hanzi-writer-data 2.0.1 and checked
against the sha256 manifest. The phone runs no matcher and loads no third-party script.

Words are spoken by Workers AI MeloTTS (`TTS_MODEL`), only for a word of a running round, asked
for by a player of that round. Each unique word in a room is one cached clip in the room's own
storage (the Cache API does nothing on workers.dev), made by up to `TTS_MAX_ATTEMPTS` model calls.
Every model call must pass, and FAILS CLOSED on: the per-IP limiter (`TTS_LIMITER`), the room's
daily budget (`TTS_ROOM_DAILY_CALLS`, reserved without an await so parallel words cannot race
it), the game's daily budget (`TTS_GLOBAL_DAILY_CALLS`, one `BudgetDO`) and each IP's daily share
of it (`TTS_IP_DAILY_CALLS`, stored only as a salted hash for the day). Room creation fails closed too. Joins are capped per room per minute.

Credits: character stroke data from Make Me a Hanzi / Arphic Technology (Arphic Public License,
served at `/licenses/ARPHICPL.TXT`); stroke checking ported from Hanzi Writer (MIT); word voice by
MeloTTS on Cloudflare Workers AI.
