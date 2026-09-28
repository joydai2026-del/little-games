# 猜猜我是谁 Stroke Reveal

Live at: **https://stroke-reveal.joyd-ai-2026.workers.dev**

An Avery Studio classroom reading game for Mandarin immersion K-5. Momo draws a character one
stroke at a time on the big screen, and the first kid to tap the right word wins. The teacher
pastes their own word list; each kid's phone shows four word cards from that list. A right tap
early in the drawing scores more than a right tap at the end. 墨墨 (Momo, the Avery Studio
puppy) tilts his head while he draws and bounces when the answer shows.

No accounts, no ads, no tracking, no sound. A display name lives only as long as the room (2 hours).

## Demo

Recorded on the live site by `scripts/record-demo.py`: a real room, a browser kid (left, phone)
tapping word cards with real clicks, an AI agent playing through the API, and the teacher's big
screen on the right. On word 2 the kid taps a wrong card first (the K-2 "try again" pause).
Silent, 1.25x speed.

![Stroke Reveal demo: Momo draws on the big screen while a kid taps word cards](docs/demo/stroke-reveal-demo.gif)

<!-- mp4 user-attachments URL: pending, JJ adds -->

Files: [stroke-reveal-demo.mp4](docs/demo/stroke-reveal-demo.mp4) · [stroke-reveal-demo.gif](docs/demo/stroke-reveal-demo.gif)

![Big screen mid-drawing](docs/demo/stroke-reveal-board-live.png)
![Kid's word cards](docs/demo/stroke-reveal-kid-cards.png)
![Winners](docs/demo/stroke-reveal-winners.png)

Live evidence: [`docs/evidence/2026-09-28-live-gate.json`](docs/evidence/2026-09-28-live-gate.json) (API gate, 22 of 22)
and [`docs/evidence/2026-09-28-live-run-record.json`](docs/evidence/2026-09-28-live-run-record.json) (the headless kid + teacher run that recorded the demo).

## Play it

1. **Teacher**: open the link on the classroom screen, paste your words (numbers, pinyin, English
   and headings like 第三课 are fine, we keep the Chinese words and tell you what we skipped), tap
   **Make a room**. Pick the class level and how many words per round. Show the big code.
2. **Kids**: open the same link on a phone, type the code and a first name, tap **Join the game**.
3. **Teacher**: tap **Start the game**. 3-second countdown, then Momo starts drawing.
4. Kids watch the big screen and tap the word on their phone. The answer shows, then the next word.
5. After the last word: Winners! Tap **Play again** for the next words in your list.

How words work: each card is one word from your list. Momo draws the FIRST character of the word
(学校 means Momo draws 学). The wrong cards never start with the same character, so there is
always exactly one right card. A word whose first character has no stroke data is left out, with
a note on the teacher screen.

Scoring: a right tap when the first stroke appears is 1000 points, falling to 100 once the
drawing is complete (`SCORING` in `src/shared/config.ts`). Most points wins; equal points and
equal right answers share a place. Nothing is ever taken away.

Levels (`LEVELS` in `src/shared/config.ts`):

| Level | Momo draws a stroke every | A wrong tap |
|---|---|---|
| K-2 | 1.5 s | cards go grey for 2 s, then try again (the tried card is marked) |
| Grades 3-5 | 0.9 s | you sit out that word |

A word closes when time runs out (6 s after the drawing is complete) or when every kid has it
right or is out. A kid who joins after Start watches and plays the next round. A kid whose phone
has not checked in for 45 seconds is left out of the next round.

Fair play: kids' phones never receive the drawn character or the right card while a word is open
(the teacher's big screen does). Beyond that, it is honor-based: the "AI" tag is what the joiner says.

## Let an AI agent play

An agent plays through the same HTTP API the phones use. It "looks at the big screen" with
`GET /api/rooms/:code/drawing` (the strokes Momo has drawn so far, nothing more) and compares them
with the public stroke data of each card's first character. No npm install, Node 18+:

```
node stroke-reveal/agent/play.mjs --url https://stroke-reveal.joyd-ai-2026.workers.dev --room ABCD --name Robo
```

Flags: `--patience 0.4` (share of the character to see before guessing, 0 to 1), `--mistakes 0.1`
(chance of tapping a wrong card, 0 to 0.9), `--poll-ms 500`, `--seed 7` (repeatable mistakes).
`STROKE_REVEAL_URL` can replace `--url`. The agent shows on the board with an "AI" tag.

### API

Every room route except create and join needs `x-player-id` and `x-player-secret` (you get them
from create or join). Errors are always JSON `{ "error": "..." }`.

| Route | Who | Body | Does |
|---|---|---|---|
| `POST /api/rooms` | teacher | `{ "text": "...paste...", "options"?: { "level"?: "k2" \| "g35", "charsPerRound"?: 5 } }` | makes a room |
| `POST /api/rooms/:code/join` | kid or agent | `{ "name": "Mia", "agent"?: true }` | joins |
| `GET /api/rooms/:code?v=N` | anyone in the room | | state, or `{ "unchanged": true }` if still version N |
| `GET /api/rooms/:code/drawing` | anyone in the room | | `{ round, question, shown, complete, strokes: [svg path...], medians: [...] }`: only the strokes on the big screen |
| `POST /api/rooms/:code/guess` | kid or agent | `{ "race": 1, "question": 0, "seq": 1, "card": 2 }` | one tap on a card |
| `POST /api/rooms/:code/start` | teacher | | lobby to playing |
| `POST /api/rooms/:code/next` | teacher | | play again with the next words |
| `POST /api/rooms/:code/list` | teacher | `{ "text": "..." }` | replace the list (not during a round) |
| `POST /api/rooms/:code/options` | teacher | `{ "level"?: "k2" \| "g35", "charsPerRound"?: 5 }` | settings |
| `GET /api/strokes/:char` | anyone | | one character's stroke JSON (hash-checked proxy) |

Guess fields: `race` is `state.round`, `question` is `state.question.index`, `card` is the index
in `state.question.cards`. `seq` is your own tap counter for the round: 1, 2, 3... (start from
`state.score.seq + 1`); a `seq` already applied is accepted and changes nothing, so retries are
safe. A guess for another round or a closed word gets 409; before the drawing starts, 409; during
the K-2 pause, 429 (wait and resend). Your own tries are in `state.mine`; the right card
(`state.question.answer`) and the drawn character (`state.question.char`) arrive once the word closes.

```
U=https://stroke-reveal.joyd-ai-2026.workers.dev
# teacher makes a room
curl -s -X POST $U/api/rooms -H 'content-type: application/json' \
  -d '{"text":"1. 大人 dàrén\n2. 山 shān\n3. 学校 xuéxiào\n4. 人 rén","options":{"level":"g35","charsPerRound":2}}'
# -> { "code": "ABCD", "playerId": "...", "playerSecret": "...", "state": {...} }

# an agent joins
curl -s -X POST $U/api/rooms/ABCD/join -H 'content-type: application/json' -d '{"name":"Robo","agent":true}'

# teacher starts (teacher headers)
curl -s -X POST $U/api/rooms/ABCD/start -H "x-player-id: $TID" -H "x-player-secret: $TSECRET"

# after the countdown, the agent looks at the big screen
curl -s $U/api/rooms/ABCD/drawing -H "x-player-id: $PID" -H "x-player-secret: $PSECRET"

# and taps card 2 of word 0 in round 1
curl -s -X POST $U/api/rooms/ABCD/guess -H 'content-type: application/json' \
  -H "x-player-id: $PID" -H "x-player-secret: $PSECRET" \
  -d '{"race":1,"question":0,"seq":1,"card":2}'
```

## Stroke data and the drawing library

All drawing goes through one adapter, `src/client/drawer.ts`, so the library can be swapped.
Everything here is copied from Trace Race with all of its mitigations.

| Piece | Source | Pin | Licence |
|---|---|---|---|
| Stroke animation | Hanzi Writer, loaded from jsDelivr | `https://cdn.jsdelivr.net/npm/hanzi-writer@3.7.3/dist/hanzi-writer.min.js`, `integrity="sha384-xd6VpwMU5AxPFzG/nyhXrW70SSR2usiUNV8RrA0wlOjYlCrZyzZC6JiR/mT51pm2"`, `crossorigin="anonymous"` | MIT |
| Character stroke data | hanzi-writer-data 2.0.1 (9,574 characters), fetched ONLY by the Worker | `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/<char>.json` | Arphic Public License ([our copy](public/licenses/ARPHICPL.TXT), served at `/licenses/ARPHICPL.TXT`) |

- exact version pins, never a range; Subresource Integrity on the script;
- the library's built-in data loader is replaced, so browsers never call the data CDN;
- `/api/strokes/:char` is not an open proxy: exactly one code point that is in the committed
  sha256 manifest (`src/worker/strokes-manifest.json`), else 400; upstream is hardcoded; the body
  is size-capped (`STROKE_MAX_BYTES`), hashed and compared to the manifest, and its JSON shape
  checked before it is returned, with `nosniff` and long cache headers;
- `/drawing` loads its paths through the same checked loader and never names the character;
- the room never calls the CDN: stroke counts are bundled (`src/worker/stroke-counts.json`).

## 墨墨 Momo

Official Momo from `avery-brand/` (the brand guide is the law): `public/momo.png` in the game
(lobby, big screen, cheer, winners), always square and uniformly scaled, animated with CSS only;
`public/momo-icon.png` in the header lockup and favicon. `npm run check:brand` compares them by sha256.

## Develop

```
npm install
npm test              # vitest (reducer, parser, cards, Durable Object, /drawing, stroke proxy, agent flow) + node agent tests
npm run typecheck
npm run check:xss     # no raw HTML from user text in src/client
npm run check:palette # colours only from public/theme.css (Avery kit) and src/client/game.css
npm run check:brand   # theme.css + Momo PNGs identical to avery-brand/, title/favicon/header/footer present
npm run deploy        # build + wrangler deploy (workers.dev only)
node scripts/live-gate.mjs        # live API gate, prints a JSON receipt
python3 scripts/record-demo.py    # live headless kid + teacher run, stills + demo mp4 + gif (--no-video for stills only)
```

Stack: one Cloudflare Worker (static assets + API), one Durable Object per room, polling.
Plan: `docs/plans/2026-09-28-stroke-reveal-plan.md`. Build report: `docs/2026-09-28-build-report.md`.

## Deferred

- Saved teacher lists and modes (the later free and paid plans). No paywall, no accounts now.
- Sound (Momo's voice, a chime on a right tap). The game is silent by design for now.
- Teacher "remove player" and "skip this word" buttons.
