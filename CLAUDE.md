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
- Every game ships a demo, recorded on the LIVE site by a script in the game's `scripts/` (Caption Wars: `scripts/record-demo.py`), never staged or mocked. Outputs go in `<game>/docs/demo/`: `<game>-demo.mp4`, `<game>-demo.gif` (under 8 MB), and 2-3 PNG stills. Raw recordings and event logs stay git-ignored. Both READMEs (root and the game's) embed the demo THREE ways, because GitHub renders each differently: (1) the gif as a normal image (plays inline everywhere), (2) the mp4 as a playable video: GitHub strips `<video>` tags and turns raw-file links into plain links, so upload the mp4 through GitHub's attachment uploader (drop it into an issue or PR comment box, do not post the comment, copy the `https://github.com/user-attachments/assets/<id>` URL it inserts) and put that URL alone on its own line, (3) plain links to the mp4 and gif files in the repo. Re-record and re-upload after any change a viewer would notice (UI, bot voice, flow). JJ set this on 2026-09-08 so she never has to ask for the video again.
- Never work on `main`: branch `feat/<game>-<thing>`. Codex reviews before anything is handed to JJ.
- Vault context lives in `.vault/` (a private vault symlink, not in this repo).
