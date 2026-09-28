# Trace Race build report (2026-09-28)

## What this is
A stroke-order (笔顺) race for Mandarin immersion K-5, built as `trace-race/` in the Little Games
repo on branch `feat/trace-race`. Teacher pastes a list, kids trace on phones, live race board.
Live (workers.dev only): https://trace-race.joyd-ai-2026.workers.dev

## Key takeaways
1. **The core loop works live, with a receipt.** Every A below is backed by
   [`evidence/2026-09-28-live-receipt.md`](evidence/2026-09-28-live-receipt.md) (deployed
   commit `5d45fb6`, version `25d11942`, room codes, timestamps, raw JSON).
2. **Review round 1 fixes are in** (both reviewers said FIX-FIRST): the phone resyncs with the
   room after a lost send, one ranking key, race id + stroke sequence (retries and replays are
   no-ops), roster frozen at Start, a server pace floor, input hardening, 64 px taps.
3. **Demo recorded live**: `docs/demo/trace-race-demo.mp4` and `.gif` (1.8 MB), embedded in both
   READMEs. The playable mp4 link (GitHub attachment upload) is pending, done by the coordinator.
4. **Tests green**: 52 vitest + 3 node tests, typecheck, `check:xss`, `check:palette`.
5. **Momo is a placeholder** SVG in one file (`public/momo.svg`).

## Recommended action
1. Watch the demo gif and play one room on a real phone.
2. Decide on real Momo art (swap `public/momo.svg`).
3. Upload the mp4 to a GitHub attachment and replace the pending comment in both READMEs.

## Verified live vs assumed (after round 4, deployed version 25d11942, commit 5d45fb6)
| Claim | Grade | Evidence (receipt + raw JSON) |
|---|---|---|
| Site, closed stroke proxy, licence, %E0 400, oversized body 413, long paste 400 | A | live gate |
| Browser kid traces with a pointer, hanzi-writer grades it, agent races via HTTP | A | round-1 runs (69Y7, 875M), full-outage run RKP5 |
| Phone and room agree after a 45 s FULL outage with nothing else changing the room | A | run RKP5, room version 6 before and after |
| Race ends on the clock via the alarm, nobody polling | A | room R8HA: 2 ms |
| Retries and replays never count twice; late joiner waits | A | room R8HA |
| Pace floor (GO + n x 250 ms) | A | stroke 2 refused at GO+450, accepted at GO+569 |
| A stale seat entered through the join link leads back to the join form | A | room VEFT |
| One presence list for "Kids here" and Start; ranking incl. zero-progress rule; outbox skip/reset; timeout fallback; hiccup clears | B | unit tests |
| Old Safari / Chrome devices; real phone touch; 25 phones at once | C | not tested |

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
| `tests/race.test.ts` | lobby, full room, start rules, countdown, order, seq no-ops, race id, pace floor, finish, clock end + expiry, race again, frozen roster, ranking key |
| `tests/room-do.test.ts` | Durable Object create/auth/race/retry/alarm/expiry, Worker routes, %E0, oversized body, long paste |
| `tests/strokes.test.ts` | proxy reject paths, hash mismatch, size cap, schema (lengths, finite points), headers with a committed real fixture |
| `tests/agent-flow.test.ts` | agent client through the real router and DO to a finished race |
| `tests/agent-lib.test.mjs` | agent stroke planning |

## Deferred
Saved teacher lists and modes (future free/paid split, no paywall now); cheat resistance beyond
the order check and pace floor (honor-based by design, said in the README); teacher "remove
player"; real Momo art; the playable mp4 attachment link (coordinator step).

## North star check
Ideal: a teacher pastes a list and 25 kids race on phones, visibly writing Chinese fast and right,
with the board on the projector. Now: that loop works end to end live with 1 browser kid and 1 AI
racer, and survives a network cut. Gap: real-phone touch test, a crowded-room test (25 phones polling), real Momo.
Drift check: every piece here is on the classroom path; nothing is pre-customer scaffolding.
