# Momo fun spikes (2026-09-28)

Three throwaway prototypes for Avery Studio classroom games. The idea behind all three: kids **perform** Chinese (say it, shout it, act it out) instead of filling in drill sheets. They exist so JJ can say keep / change / cut for each one. They are not shipped game modes.

**Start here:** open `review.html` (double-click it). It shows all three side by side with Keep / Change / Cut buttons and an "Export feedback" button. Open it as a local file, not as a published page, so the feedback export works.

## The three spikes

| File | What the kid does | What Momo does |
|---|---|---|
| `teach-momo.html` | Plays teacher. Reads the big word out loud, taps "I said it!" | First confused ("Huh? Say it again!"), then gets it, bounces, repeats the word (with pinyin if the teacher pasted it). Counter: "Momo learned N words". |
| `karaoke-blanks.html` | Reads along as words play one at a time with a moving highlight. At a blank, the whole class shouts the missing word. | Sways along, makes an "O" mouth at a blank, jumps and cheers (好棒！ etc.) when the word is shown. |
| `comic-bubbles.html` | Fills empty speech bubbles in a 3-panel comic (tap a bubble, tap a word), then acts the strip out. Shuffle and Print (Letter or A4). | Is the main character in the comic, next to a coral friend. |

## How to open

Double-click any `.html` file. No install, no internet, no account. Each one is a single file that works offline (system fonts only, no outside requests).

Every spike starts with a paste box. Paste the class word list as it is: numbered lists, Google Sheets or Excel columns, CSV lines and `苹果/píngguǒ` all work. Only the Chinese words are kept, each with the pinyin that follows it. Pinyin is kept only when it has tone marks (píngguǒ) or tone numbers (ping2guo3); English is dropped. The last pasted list is remembered in this browser, so switching between the three spikes does not need a second paste.

**How they are played:** these spikes are **teacher-tapped on one shared screen** (a projector, a smartboard or a tablet the class gathers around). The buttons are in plain English for the teacher; each main button also carries a picture (a mouth for "I said it!", an arrow for "Next word", an eye for "Show the word") so a child who cannot read English yet can follow along. Whether kid-facing screens should have any English at all in an immersion classroom is an open question for JJ.

The Momo drawing is a **placeholder** (a simple ink drop). There is no official Momo art yet. All three files use the same Momo drawing; each mode only switches which mouth shows (smile, "O", or wavy). The placeholder note lives here, in the PR and on `review.html`, never on the screens teachers and kids see.

**The three files share one block of code** (the paste reader, small helpers, button icons), one colour block and one Momo drawing. They are copied into each file on purpose, so each spike still works as a single file. **They must stay identical:** change all three together. `check.py` fails if they drift.

## Settings (no code changes needed)

Each file has a `CONFIG` block at the top of its script: Teach Momo (tries before Momo gets it, Momo's lines, smallest and largest list, when long words wrap), Karaoke (slow / normal / fast word timing, which words start as blanks, the blank mark, cheers, pause after a reveal, smallest and largest list), Comic (panel layout, who stands where, bubble positions, bubble text size by word length, smallest and largest list, paper and print margin).

| Spike | Smallest list | Largest list (longer lists use the first N words, after a warning) |
|---|---|---|
| Teach Momo | 1 word | 30 words |
| Karaoke Blanks | 3 words | 30 words |
| Comic Bubbles | 3 words | 24 words |

## What would make each one a real mode

| Spike | Needed to become a real mode |
|---|---|
| Teach Momo | Real Momo art with 3-4 poses; real voice for Momo repeating the word (recorded or TTS, with a mute switch); optional "class mode" on a projector where the whole class teaches Momo; a finish screen the teacher can show. |
| Karaoke Blanks | Real sentences or song lines instead of single words (needs a sentence field in the paste, or teacher-written lines); optional music track and tempo; a projector layout; blanks chosen by the teacher and saved with the list. |
| Comic Bubbles | More comic templates (2, 3, 4 panels, different scenes); a way for kids to write their own words on the printout; real character art; a classroom "act it out" timer or role cards. |

All three would also need: the shared Avery word-list import (instead of paste only), a real mascot pack, and a proper phone/tablet/projector test on real devices.

## Repo rules these spikes waive, and why

The Little Games repo rules say every game has an AI-agent HTTP API, unit tests (vitest), and a demo video recorded on the live site. These spikes skip all three on purpose: they are throwaway prototypes that exist only so JJ can say keep, change or cut. Whichever one is kept becomes a real mode, and it gets the agent API, tests and demo video then. In place of tests there is one headless browser check, `check.py`.

## Checking them again

`python3 check.py` (needs Python Playwright with Chromium). It runs every flow silently in a headless browser at phone and laptop width, refreshes the screenshots in `shots/` and writes `check-receipt.txt`.

## Files

- `teach-momo.html`, `karaoke-blanks.html`, `comic-bubbles.html`: the spikes
- `review.html`: review board for JJ (Keep / Change / Cut)
- `shots/`: phone-width screenshots taken mid-game, the comic at laptop width, long-word screens, and the printed comic page on Letter and A4
- `check.py`, `check-receipt.txt`: the repeatable browser check and its latest result
- `BUILD-REPORT.md`: what was built and checked
