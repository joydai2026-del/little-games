# Little Games

Small games JJ plays with AI players or with friends. One game per folder. Read this before touching anything.

## Folder map
- `caption-wars/` : one photo drops, everyone captions, vote the winner. Web app on Cloudflare.
- Each game owns its own `README.md`, `package.json`, tests, and `docs/plans/`.

## House rules for this repo
- Plain English UI. Grandma test: no jargon, no setup steps on screen, phone-first.
- Every game must be playable two ways: a human opens the link, and an AI agent joins through the same HTTP API (agent-native).
- No accounts, no ads, no tracking, no personal data stored beyond a display name for the life of a room.
- Real photos and real model output only. No mock data in anything JJ sees.
- Anything that could change (round length, bot count, photo tags, model ids, vote rules) is config, never a literal in game logic.
- Stack, unless a game needs otherwise: one Cloudflare Worker (static assets + API), Durable Object per room, Workers AI for the bots, vitest for logic. Same shape as the author's Bilingual Vocab Game.
- Never work on `main`: branch `feat/<game>-<thing>`. Codex reviews before anything is handed to JJ.
- Vault context lives in `.vault/` (a private vault symlink, not in this repo).
