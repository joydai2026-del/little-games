# Caption Wars

One photo drops, everyone captions it, everyone votes for the winner. Phone-friendly web game,
humans and AI bots play in the same round. No accounts, no ads, no tracking.

Plan (the contract this is built from): `docs/plans/2026-09-07-mvp-plan.md`.

## Stack

One Cloudflare Worker (static assets + API), one Durable Object per room, Workers AI for the bots,
vitest for the game logic. Same shape as `/Users/joyd/Bilingual Vocab Game Generator`.

## Commands

```
npm install       # install dependencies
npm run dev       # vite dev server (client only, no worker)
npm run cf:dev     # build + wrangler dev (full worker + DO + AI locally)
npm test          # vitest run (src/shared/room.ts and friends)
npm run typecheck # tsc --noEmit for both the client/shared and worker configs
npm run build     # vite build -> dist/client
npm run deploy    # build + wrangler deploy
```

## Layout

```
src/shared/   pure game logic (types, config, personas, rng, ids, room reducer) + no I/O
src/client/   the browser app (vanilla TS, no framework)
src/worker/   the Cloudflare Worker: HTTP router + RoomDO (durable object per room)
agent/        agent-native path: a terminal script that joins a room over the same HTTP API
tests/        vitest specs for src/shared/
```
