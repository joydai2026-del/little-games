# Demo recording pipeline: how it works, what was recorded

2026-09-08. Branch `feat/caption-wars-public-demo`. Validated against the live URL:
`https://caption-wars.joyd-ai-2026.workers.dev`. Two full runs were recorded during the build;
the committed deliverables in `docs/demo/` are from the second run (room RLWJ).

## How to run it

```bash
# 1. Python 3.10+ and pip
python3 --version                        # needs 3.10 or newer

# 2. Playwright (Python package) and its Chromium browser
python3 -m pip install playwright        # or: pip install playwright
python3 -m playwright install chromium   # one-time, downloads the browser binary

# 3. ffmpeg + ffprobe on PATH (used for the mp4/gif post-processing step)
brew install ffmpeg                      # provides both ffmpeg and ffprobe

# 4. run it
cd "caption-wars"
python3 scripts/record-demo.py [URL] [--rounds N] [--out DIR]
```

`URL` defaults to the live Worker, `--rounds` defaults to 3, `--out` defaults to `docs/demo`.
That single command now does everything: drives the browser, saves the raw recording and
stills, and (as its final step) runs ffmpeg to produce `caption-wars-demo.mp4` and
`caption-wars-demo.gif` in the same output directory. No separate ffmpeg step needed; ffmpeg
itself still needs to be installed (`/opt/homebrew/bin/ffmpeg` or `ffmpeg` on PATH).

`scripts/record-demo.py` is a tool, not part of the app, same category as `scripts/ai-try.mjs`.
It drives the real deployed UI end to end: types a name, opens Game settings, sets the smallest
available caption/vote timers, sets AI players to the max (4), creates a room, starts the game,
types a real host caption a few seconds into each caption phase (from a small list of
plain one-liners, so the round doesn't wait out the full timer once every bot and the host
have captioned), casts one real vote per round, and stops at the final scores. It never mocks
data. Hard cap: 6 minutes (the real run finished in 144s, well under it).

The gif step tries the full run first and only trims it (shrinking `-to` and retrying) if the
result comes out over 8 MB, so a future run with different timings self-adjusts instead of
needing a hand-picked `-to` value.

## What was recorded (committed take)

This is an automated demonstration, not a person playing: the "You" host is scripted (the
script types a fixed caption from a small rotating list and casts one automatic vote per
round). Two takes were recorded during the build; the one committed to `docs/demo/` is the
**second** run, not the first draft this doc originally described.

| Item | Value |
|---|---|
| Room | RLWJ, host "You" (scripted) + 4 AI players (Daisy Deadpan, Chaos Chip, Sunny Wholesome, Dramatic Rex) |
| Settings used | 3 rounds, 30s to write a caption, 15s to vote, 4 AI players |
| Total wall time | 69.5s (t=0 script start to final results at t=67.8s, video saved at t=69.5s) |
| Raw recording | `docs/demo/caption-wars-raw.webm`, 1:08.08, 2.40 MB |
| Result | Joint champions: You and Dramatic Rex, 3 points each. Chaos Chip 2, Daisy Deadpan 0, Sunny Wholesome 0 (read from `still-03-final.png`) |
| Photos shown | 3 distinct real photos, one per round: goat (round 1), otters (round 2), squirrel (round 3) |

Per-round detail, timestamps from `docs/demo/events.json`, photos/captions/winners confirmed
against the stills and mp4:

| Round | Photo | Caption phase (t) | Vote phase (t) | Reveal (t) | Round winner |
|---|---|---|---|---|---|
| 1 | goat | 5.2s | 11.1s | 15.3s | Chaos Chip |
| 2 | otters | 26.6s | 32.5s | 36.3s | You, "Nobody asked, but here we are" (3 votes) |
| 3 | squirrel | 47.6s | 53.5s | 57.3s | Dramatic Rex, "The squirrel just realized it can't fit this walnut through airport security" (3 votes) |

## Output files

Sizes from `ls -l`, durations from `ffprobe -show_entries format=duration`, both re-measured
directly against the committed files (not copied from an earlier draft).

| File | Size | Duration | Notes |
|---|---|---|---|
| `docs/demo/caption-wars-demo.mp4` | 0.81 MB (853,868 bytes) | 44.4s | H.264, yuv420p, full game at 1.5x speed, first 1s dropped |
| `docs/demo/caption-wars-demo.gif` | 7.78 MB (8,152,576 bytes) | 67.1s | 390px wide, 10fps, palette-optimized. Fits under the 8 MB cap on the first full-length attempt, no trimming needed for this take. |
| `docs/demo/still-01-lobby.png` | 107 KB | - | Lobby, all 5 players + settings line |
| `docs/demo/still-02-vote.png` | 555 KB | - | Room RLWJ, round 1 of 3, goat photo, "Pick the best caption" with distinct bot captions visible |
| `docs/demo/still-03-final.png` | 117 KB | - | Final scores screen, room RLWJ, joint champions banner |
| `docs/demo/caption-wars-raw.webm` | 2.40 MB (2,512,546 bytes) | 68.1s | Kept for debugging / re-encoding; not part of the deliverable set |
| `docs/demo/events.json` | 1.4 KB | - | Phase-change timestamp log the script writes on every run |

## Frame-by-frame verification (looked at actual pixels, not just file existence)

All three PNG stills opened directly and confirmed:
- `still-01-lobby.png`: Room RLWJ, "In the room" list shows You (YOU, HOST) plus 4 named AI
  players (Daisy Deadpan, Chaos Chip, Sunny Wholesome, Dramatic Rex), settings line reads
  "3 rounds - 30s to write - 15s to vote - 4 AI players"
- `still-02-vote.png`: Room RLWJ, "ROUND 1 OF 3", the real goat photo, "Pick the best caption"
  with distinct bot captions as tappable cards
- `still-03-final.png`: Room RLWJ, "Joint champions: You and Dramatic Rex / 3 points over 3
  rounds", full scoreboard (You 3, Dramatic Rex 3, Chaos Chip 2, Daisy Deadpan 0, Sunny
  Wholesome 0), "Play again" button

Because this is an automated demonstration, every screen shown was produced by the scripted
host (fixed captions typed from a list, one automatic vote per round) plus real AI-model bot
captions, not a live human playing.

## Discrepancies vs the brief (read from the live DOM, not guessed)

The brief said "the smallest option available" for the two timer selects, with the server minimums
noted as 15s (caption) and 10s (vote). The live `<select>` elements (read from the deployed page's
DOM, not assumed) carry different option sets:

- `#opt-caption-seconds`: 30 / 45 / 60 / 90 / 120 -- smallest available is **30s**, not 15s.
- `#opt-vote-seconds`: 15 / 20 / 30 / 45 / 60 -- smallest available is **15s**, not 10s.

It looks like the brief's two numbers (15 and 10) were swapped/off relative to what the UI
actually offers. The script uses the true smallest option in each select (30s / 15s) rather than
a value that doesn't exist in the dropdown. Also: the brief describes a card marked "YOURS" (caps);
the live UI's own-caption tag actually reads "yours" (lowercase, class `.vote-tag`); the script
selects on `button.vote-card:not(.vote-own)` (a CSS class) rather than matching visible text, so
this had no functional effect.

## What was NOT verified

- Two full runs were executed during the build (per the 30-minute time box); this doc describes
  the second, committed run. Timing (69.5s wall time) will vary run to run since bot caption
  generation calls a real model.
- No re-run was done after a fresh deploy; the task notes this pipeline will be re-run post-deploy,
  which will produce a new raw recording and new stills/mp4/gif.
- The raw `.webm` and `docs/demo/events.json` are left in `docs/demo/` alongside the deliverables;
  not evaluated for whether they should be gitignored (no `.gitignore` for `docs/demo/` was created
  or touched).

## Known issue found and fixed during the build

The first run crashed mid-game: `context.close()` raised `TargetClosedError` because the browser
process closed itself unexpectedly around t=82s (page/context closed event, no explicit crash
reason logged). The partial `.webm` was still saved by Playwright despite the crash. Fixed by:
wrapping `context.close()` / `browser.close()` in their own try/except in the script's `finally`
block (so a mid-run browser death doesn't hide the real error or skip video finalization), and by
resolving `video.path()` while still inside the `with sync_playwright()` block (calling it after
that block exits raises "Event loop is closed"). The second full run completed cleanly with no
crash; whether the first crash was a one-off Chromium hiccup or a reproducible issue was not
investigated further (time box).
