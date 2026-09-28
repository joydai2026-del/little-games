# Trace Race plan (2026-09-28)

One page. What the game is, how a room moves, what can be tuned, how an agent plays, what waits.

## Game loop
1. Teacher opens the site, pastes a character list (messy is fine: numbers, pinyin, English, commas), taps "Make a room".
2. The room keeps only the Chinese characters, in order, no repeats. Any character with no stroke data is listed for the teacher ("No stroke data for X, skipped"), never a crash.
3. Kids open the link on their phones, type the code and a first name, and wait.
4. Teacher taps "Start". A 3-second "Ready, set, go" countdown, then every kid gets the same characters in the same order.
5. Each kid traces inside a big 田字格 (the four-square writing grid). Correct stroke = it fills in ink. Wrong stroke = the stroke wiggles and the hint shows. Finish a character = 墨墨 (Momo) cheers and the next one appears.
6. The teacher screen is a live race board: every kid, which character they are on, how many they have done.
7. The race ends when time runs out or everyone finishes. Board shows the winners. Teacher taps "Race again" for the next characters in the list.

## Room state machine
| Phase | Moves to | When |
|---|---|---|
| lobby | racing | teacher taps Start (at least 1 kid in the room, at least 1 traceable character) |
| racing | done | clock passes the race end, or every kid finished every character |
| done | racing | teacher taps Race again (next chunk of the list, wraps to the start) |
| any | gone | 2 hours after the room was made |

The first 3 seconds of `racing` are the countdown; strokes sent before the go moment are refused.

## Scoring
Characters finished (more is better), then mistakes (fewer is better), then who got there first. No points taken away for anything.

## Config surface (`src/shared/config.ts`, validated, clamped)
| Setting | Default | Teacher can change on screen |
|---|---|---|
| secondsPerChar | 30 | yes ("Seconds per character") |
| charsPerRound | 5 | yes ("Characters per race") |
| hints | on | yes ("Show stroke hints, best for K-2") |
| countdownSeconds | 3 | no |
| maxKids | 40 | no |
| maxListChars | 30 | no (also keeps stroke lookups under the free-plan request cap) |
| roomTtlMinutes | 120 | no |
Stroke data base URL and cache time are Worker vars in `wrangler.jsonc`.

## Agent API (same HTTP API the phones use)
`POST /api/rooms` (teacher), `POST /api/rooms/:code/join`, `GET /api/rooms/:code?v=N`, `POST /api/rooms/:code/stroke {charIndex, strokeIndex, result: "correct"|"mistake"}`, plus teacher-only `start`, `list`, `next`. `agent/play.mjs` joins a room and traces at a human-ish pace with a few mistakes.

## Stroke data and tracing
All tracing goes through one adapter, `src/client/tracer.ts`. Library (hanzi-writer, MIT) only if the two-round scan says PASS/WARN; pinned exact version from jsDelivr with an integrity hash. Character JSON is always proxied by the Worker at `/api/strokes/:char` so the browser never calls a third-party CDN for data. If the scan fails: a fallback tracer that animates stroke order from the proxied JSON and uses tap-the-next-stroke.

## Deferred
- Saved teacher lists and modes (the later free/paid split). No paywall, no accounts now.
- Cheat resistance beyond order checks (a script can finish instantly; fine for a classroom).
- Sound, recorded demo video (needs the demo script like Caption Wars), custom domain.
- Real 墨墨 art (the SVG is a placeholder).
