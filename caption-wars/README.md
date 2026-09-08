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

## Agent player

`agent/play.mjs` lets one of JJ's logged-in AI CLIs join a live room from a terminal, over the exact
same HTTP API the browser uses (join, poll, caption, vote). Node 18+, ESM, zero npm dependencies
(uses the built-in `fetch`).

```
node agent/play.mjs --room CODE --name "Claude" --brain claude
node agent/play.mjs --url https://caption-wars.example.workers.dev \
  --room CODE --name "Codex" --brain codex --style "deadpan detective" --once
```

| Flag | Meaning |
|---|---|
| `--url <base>` | Room server base URL (default: env `CAPTION_WARS_URL`) |
| `--room <CODE>` | 4-letter room code to join (required) |
| `--name <name>` | Display name to join with (required) |
| `--brain <name>` | `claude` \| `codex` \| `grok` \| `echo` (default: `echo`) |
| `--style <text>` | Optional one-line persona, e.g. `"deadpan detective"` |
| `--once` | Leave after one game (see note below: this is also the current default) |

`BRAIN_TIMEOUT_MS` (default `60000`) caps how long a brain process may run before it is killed and
the action is skipped. A brain that errors, times out, or gives an unusable answer never crashes the
script: the action for that round is skipped and polling continues.

### The three brains, and which ones actually see the photo

| Brain | Sees the photo? | Command shape |
|---|---|---|
| `claude` | **Yes** | `claude -p "Look at the image file at <path> using your file-reading tool. <prompt>"` |
| `codex` | **Yes** (native image attach) | `codex exec -m gpt-5.5 -c 'mcp_servers={}' -c memories.use_memories=false -c memories.generate_memories=false -c suppress_unstable_features_warning=true --sandbox read-only --skip-git-repo-check "<prompt>" -i <path>` |
| `grok` | **No, DEGRADED** | `grok -p "<prompt>"` |
| `echo` | N/A (no model) | fixed text, for tests / dry runs |

**`grok` is DEGRADED**: `grok --help` (checked 2026-09-07) has no image-attach flag, so the grok brain
captions and votes blind, from the prompt text alone, never seeing the actual photo. The script prints
a warning at startup when `--brain grok` is used, and this is stated here so nobody mistakes a grok
caption for one that looked at the picture.

Two implementation notes discovered while wiring `codex` up live: the prompt must come **before**
`-i <path>` on the command line (codex's `-i` flag is variadic and otherwise swallows the prompt text
as another image argument), and `--skip-git-repo-check` is required because this script may run from a
directory codex does not already trust.

### Live goat test (verified 2026-09-07)

Both vision brains were run for real against a genuine 800x600 goat close-up photo
(`/tmp/lf-goat.jpg`, fetched today) copied to a filename with no hint of "goat" in it, to prove the
brain is reading the actual pixels and not guessing from a filename or path.

**claude:**
```
claude -p "Look at the image file at /tmp/lf-photo-test-9182.jpg using your file-reading tool. Reply with exactly two lines: line 1 = the single word naming the animal in the photo; line 2 = a short funny one-line caption."
```
Answer:
```
Goat
Staring into the camera like you just said his horns look asymmetrical.
```

**codex:**
```
codex exec -m gpt-5.5 -c 'mcp_servers={}' -c memories.use_memories=false -c memories.generate_memories=false -c suppress_unstable_features_warning=true --sandbox read-only --skip-git-repo-check "Look at the attached image. Reply with exactly two lines: line 1 = the single word naming the animal in the photo; line 2 = a short funny one-line caption for the photo (no quotes)." -i /tmp/lf-photo-test-9182.jpg
```
Answer (stdout only; codex's reasoning/log noise goes to stderr):
```
goat
When you open the front camera by accident
```

Both correctly named "goat" with no hint from the filename, confirming both brains genuinely view the
photo. Grade A: proven live, on this machine, today.

### Tests

```
node --test tests/agent-lib.test.mjs tests/agent-flow.test.mjs
```

`tests/agent-lib.test.mjs` unit-tests the sanitizer and vote-number parser in `agent/lib.mjs` (quote
stripping, one-line collapse, 120-char cap, tolerant "pick a number" parsing). `tests/agent-flow.test.mjs`
runs the real `runAgent()` main loop from `agent/play.mjs` against a fake in-process HTTP server that
speaks the room API (join, poll, photo, caption, vote) with the `echo` brain, and asserts: the caption
and vote land with the correct `x-player-id` / `x-player-secret` headers, the echo brain votes for the
first votable caption, and a caption/vote phase where the agent is excluded from `roundPlayerIds` sends
no requests at all. No `"test:agent"` npm script was added (another edit was touching `package.json` at
the same time); run the command above directly, or add the script yourself:
`"test:agent": "node --test tests/agent-lib.test.mjs tests/agent-flow.test.mjs"`.

### Design call: what happens after `done`

The plan asked for a decision on whether the script should exit at `done` or wait for a new room when
`--once` is not given. There is no API for a joiner to discover a successor room: "Play again" on the
Done screen creates a brand-new room code that is never handed back to an already-joined agent. So
`agent/play.mjs` always exits once a room reaches `done`, regardless of `--once`. The flag is still
accepted and logged, kept for forward-compatibility if a room-succession endpoint is ever added.
