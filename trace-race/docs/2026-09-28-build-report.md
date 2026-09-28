# Trace Race build report (2026-09-28)

## What this is
A stroke-order (笔顺) race for Mandarin immersion K-5, built as `trace-race/` in the Little Games
repo on branch `feat/trace-race`. Teacher pastes a list, kids trace on phones, live race board.
Live (workers.dev only): https://trace-race.joyd-ai-2026.workers.dev

## Key takeaways
1. **The core loop works live.** A real room, a browser kid tracing 山 水 火 with real pointer
   drags (graded by Hanzi Writer), and an AI agent racing through the HTTP API, finished on the
   deployed site with the right winner on the board. Run twice, same result.
2. **Library cleared, mitigations applied.** Two-round scan: both WARN. Every required
   mitigation is in (list below).
3. **Tests green.** 35 vitest + 3 node tests, typecheck clean, `check:xss` and `check:palette` pass.
4. **Momo is a placeholder** SVG in one file (`public/momo.svg`).

## Recommended action
1. Look at the stills in `docs/demo/` and play one room on a real phone.
2. Decide on real Momo art (swap `public/momo.svg`).
3. Record the demo video per the repo convention (not done).

## Verified live vs assumed
| Claim | Grade | Evidence |
|---|---|---|
| Site and API up on workers.dev | A | deploy version 7feb98eb; home 200 |
| `/api/strokes/我` returns the exact upstream bytes | A | live sha256 `08616462...6ac8` equals manifest; headers json, nosniff, `public, max-age=2592000, immutable` |
| Proxy rejects traversal and multi-char | A | live `..%2Fx` and `我们` both 400 |
| Missing-data character noted, no crash | A | live lobby: "No stroke data for 𠮷, skipped." |
| Browser kid can trace with a pointer and hanzi-writer grades it | A | `scripts/live-run.py`, rooms UWGZ and LDK5: Mia finished 3 of 3 |
| Agent joins and races over HTTP | A | `agent/play.mjs` in the same rooms: 11 strokes, 2 mistakes, 3 of 3, place 2 |
| Race ends when everyone finishes; scoring order | A | live board: Mia 1st (0 mistakes), Robo 2nd (2 oops) |
| Race ends on the clock via the alarm | B | `tests/room-do.test.ts` (fake storage); not waited out live |
| Real touch on a real phone | C | only headless Chromium with mouse events; hanzi-writer also listens to touch events (source) |
| Size cap and schema check on the proxy | B | unit tests; the live upstream never trips them |
| Race again / change list / settings steppers | B | reducer tests; not clicked live |

## Library verdict and version
- hanzi-writer **3.7.3** (MIT), classic script from jsDelivr with SRI
  `sha384-xd6VpwMU5AxPFzG/nyhXrW70SSR2usiUNV8RrA0wlOjYlCrZyzZC6JiR/mT51pm2`, `crossorigin=anonymous`.
  The SRI hash was also recomputed locally from both the scanned tarball and the live CDN: identical.
- hanzi-writer-data **2.0.1** (Arphic Public License), fetched only by the Worker.
- Mitigations applied: exact pins; SRI; custom `charDataLoader` pointing at `/api/strokes/:char`;
  proxy accepts one manifest code point only (committed manifest, 9,574 entries), hardcoded
  upstream, sha256 check, size cap (`STROKE_MAX_BYTES`, 65,536), JSON shape check, nosniff;
  Arphic licence text served from our own `/licenses/ARPHICPL.TXT` (byte-identical to the CDN copy);
  credits line in the home and lobby footer and the README.
- Design choice: the room bundles verified stroke counts (`src/worker/stroke-counts.json`,
  83 KB) so it never calls the CDN; `scripts/make-stroke-counts.mjs` rebuilds it and refuses any
  hash mismatch.

## Files
- Plan: `docs/plans/2026-09-28-trace-race-plan.md`
- Game rules (pure): `src/shared/race.ts`, parser `src/shared/parse.ts`, config `src/shared/config.ts`
- Room Durable Object: `src/worker/room-do.ts`; router `src/worker/index.ts`; stroke proxy `src/worker/strokes.ts`
- Tracer adapter (only file that knows the library): `src/client/tracer.ts`
- Agent: `agent/lib.mjs`, `agent/play.mjs`
- Live run: `scripts/live-run.py`; stills in `docs/demo/`

## Tests
| File | Covers |
|---|---|
| `tests/parse.test.ts` | 7 messy-paste fixtures (numbered pinyin list, mixed commas, spreadsheet tabs, traditional + punctuation + emoji, slide bullets, no Chinese, cap) |
| `tests/race.test.ts` | lobby, start rules, countdown, in-order strokes, duplicates, finish, clock end, race again, late join, scoring |
| `tests/room-do.test.ts` | Durable Object create/auth/race/alarm/expiry, Worker routes |
| `tests/strokes.test.ts` | proxy reject paths, hash mismatch, size cap, schema, headers |
| `tests/agent-flow.test.ts` | agent client through the real router and DO to a finished race |
| `tests/agent-lib.test.mjs` | agent stroke planning |

## Deferred
Demo video; saved teacher lists and modes (future free/paid split, no paywall now); cheat
resistance beyond order checks; real Momo art; Codex review of this branch (not run by this builder).

## North star check
Ideal: a teacher pastes a list and 25 kids race on phones, visibly writing Chinese fast and right,
with the board on the projector. Now: that loop works end to end live with 1 browser kid and 1 AI
racer. Gap: real-phone touch test, a crowded-room test (25 phones polling), demo video, real Momo.
Drift check: every piece here is on the classroom path; nothing is pre-customer scaffolding.
