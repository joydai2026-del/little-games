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

Every spike starts with a paste box. Paste the class word list as it is: numbers, pinyin and English are fine, only the Chinese words are kept. Pinyin is kept only when it has tone marks (píngguǒ) or tone numbers (ping2guo3). The last pasted list is remembered in this browser, so switching between the three spikes does not need a second paste.

The Momo drawing is a **placeholder** (a simple ink drop). There is no official Momo art yet. The same drawing is used in all three files.

## Settings (no code changes needed)

Each file has a `CONFIG` block at the top of its script: Teach Momo (tries before Momo gets it, Momo's lines), Karaoke (slow / normal / fast word timing, which words start as blanks, cheers, pause after a reveal), Comic (panel layout, who stands where, bubble positions).

## What would make each one a real mode

| Spike | Needed to become a real mode |
|---|---|
| Teach Momo | Real Momo art with 3-4 poses; real voice for Momo repeating the word (recorded or TTS, with a mute switch); optional "class mode" on a projector where the whole class teaches Momo; a finish screen the teacher can show. |
| Karaoke Blanks | Real sentences or song lines instead of single words (needs a sentence field in the paste, or teacher-written lines); optional music track and tempo; a projector layout; blanks chosen by the teacher and saved with the list. |
| Comic Bubbles | More comic templates (2, 3, 4 panels, different scenes); a way for kids to write their own words on the printout; real character art; a classroom "act it out" timer or role cards. |

All three would also need: the shared Avery word-list import (instead of paste only), a real mascot pack, and a proper phone/tablet/projector test on real devices.

## Files

- `teach-momo.html`, `karaoke-blanks.html`, `comic-bubbles.html`: the spikes
- `review.html`: review board for JJ (Keep / Change / Cut)
- `shots/`: phone-width screenshots taken mid-game, plus the printed comic page on Letter and A4
- `BUILD-REPORT.md`: what was built and checked
