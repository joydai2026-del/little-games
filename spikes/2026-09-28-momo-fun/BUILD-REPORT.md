# Build report: Momo fun spikes (Track D)

Date: 2026-09-28. Branch: `feat/momo-fun-spikes` (draft PR #8). Folder: `spikes/2026-09-28-momo-fun/`. Nothing outside this folder was touched. Nothing deployed, no packages installed.

Evidence grades: A = proven in production, B = proven in source or by the committed check (`check.py`, result in `check-receipt.txt`), C = not verified.

Round 2 (same day): both PR reviewers said FIX-FIRST. All must-fixes and the should-fixes listed under "Review fixes" were applied. Round 3: one regression from the long-word fix (Teach Momo's button pushed off landscape screens) was fixed, plus the listed small items; see "Round 3 fixes".

## What each spike does

These are **teacher-tapped on one shared screen** (projector, smartboard or a tablet the class gathers around). Buttons are plain English for the teacher, and each main kid action also has a picture (ear, mouth, arrow, star, eye, play, replay, shuffle, printer). Whether kid-facing screens should carry any English in an immersion classroom is JJ's call.

| Spike | Flow | Grade |
|---|---|---|
| `teach-momo.html` | Paste list, Start. One word shows as big as the screen allows: sized by both width and height, so the button always stays on screen; long words wrap onto even lines, short words stay on one line. Button cycles: "Teach Momo" (ear; Momo leans in, "I'm listening...") then "I said it!" (mouth; 1st tap: Momo tilts, wavy mouth, red "?", "Hmm? One more time!"; 2nd tap: Momo bounces with sparkles, bubble repeats the word (even lines) plus pinyin if pasted, counter goes up) then "Next word" (arrow) or "Finish" (star). End screen: "Momo learned all N words!" (or "Momo learned the word!" for one), "Teach again". | B |
| `karaoke-blanks.html` | Paste list, Next. Word chips appear, every 3rd word pre-marked as a blank (tap to toggle). Speed: Slow / Normal / Fast. Play: a lyric strip scrolls along the top, the current word shows huge and lights up coral one character at a time (so a wrapped word still lights in reading order). At a blank: dashed "?" box, mouth icon plus "Everybody, shout it!", Momo makes an "O" mouth, "Show the word" (eye). One tap: word pops in, Momo jumps, cheer bubble, song continues. End: "That's the song!". "New list" returns to a clean paste step. | B |
| `comic-bubbles.html` | Paste list, "Make the comic". 3 panels stacked full width on every screen size (Momo alone; Momo + coral friend; friend + Momo), 5 dashed "tap me" bubbles. Tap a bubble (it glows), tap a word; selection hops to the next empty bubble. Bubble text shrinks by word length and wraps, and two bubbles in a panel each stay under half the width. Shuffle uses every word once before repeating and leaves bubble 1 highlighted. "Empty the bubbles" resets. Print (Letter or A4) prints only the comic plus "Act it out! Name: ____"; panel height follows the paper and the print margin, so it stays one page. Printing before a comic exists, or after "New list", prints "Make the comic first, then print." | B |

Shared by all three (verified identical by `check.py`): the paste reader, small helpers and button icons (one JS block); the colour tokens (one CSS block); the Momo SVG markup. Momo is the same base art in every file; each mode shows its own mouth states through CSS (Teach: smile, "O", wavy; Karaoke: smile, "O"; Comic: smile). All colours live in `:root` tokens (core palette plus white, button shadows, error, soft coral, selected, muted); the SVG uses the tokens through CSS classes. Motion is CSS only; no network requests; system fonts only; `prefers-reduced-motion` respected; localStorage wrapped in try/catch. Tunable values sit in each file's `CONFIG` (word-count limits, when long words wrap, blank mark, bubble sizes, print margin, timings).

Paste reader: pairs each Chinese word with the pinyin that follows it before looking at separators, so tab columns (Google Sheets, Excel), CSV lines, `苹果/píngguǒ`, numbered lists and `píngguǒ 苹果` all keep their pinyin. Lines that start with pinyin (`píngguǒ 苹果 xiāngjiāo 香蕉`) give each word the pinyin before it. Pinyin needs tone marks or tone numbers; English is dropped. Known limits: an English word with an accent (café) is read as pinyin (C, not in check.py); a line with several words where pinyin is missing for some of them in an unusual order (`苹果 香蕉 píngguǒ`) can attach the pinyin to the wrong word (B, reviewer probe). One word per line, the usual teacher list, is always paired correctly (B).

## Screenshots (`shots/`, refreshed by `check.py`)

| File | Width | Shows |
|---|---|---|
| `teach-momo.png` | phone 390 | Momo just learned 苹果, bubble 苹果 / píngguǒ, counter "1 word", arrow on "Next word" |
| `teach-momo-confused.png` | phone 390 | First "I said it!": Momo confused, mouth icon on the button |
| `teach-long-word.png` | phone 390 | 巧克力蛋糕 on two even lines, answer bubble, button on screen |
| `teach-landscape-1280x720.png` | 1280x720 | 9-character word, answer bubble, Momo and the Finish button all on screen |
| `karaoke-setup.png` | phone 390 | Chips with 西瓜 and 橙子 as blanks, Fast selected |
| `karaoke-singing.png` | phone 390 | 苹果 lighting up |
| `karaoke-blank.png` | phone 390 | Blank: "?" box, "Everybody, shout it!", eye on "Show the word" |
| `karaoke-blanks.png` | phone 390 | 西瓜 revealed, Momo cheering |
| `comic-bubbles.png`, `comic-bubbles-top.png` | phone 390 | Fruit words placed, one bubble selected, word tray |
| `comic-long-words.png` | phone 390 | 3 to 5 character words (巧克力蛋糕, 一石二鸟, 谢谢你) in bubbles, no collisions |
| `comic-laptop.png` | laptop 1280 | Same comic on a laptop: full-width panels, no collisions |
| `comic-print-letter.png`, `comic-print-a4.png` | print | Printed page, 1 page each |
| `review-board.png` | 1280 | The review board (first round) |

## Verified by the committed check (`python3 check.py`, 88 PASS, 0 FAIL; full list in `check-receipt.txt`)

Headless Chromium through Python Playwright, phone 320x568 and 390x844, laptop 1280x800, 1280x720 and 1366x768, sound stubbed.

| Area | What is checked | Grade |
|---|---|---|
| Shared code | JS block, CSS token block and Momo SVG identical in all 3 files; no colour literals outside `:root`; no placeholder note on screen | B |
| Paste reader | 14 cases: numbered, tab, CSV, slash, tone numbers, pinyin-first line with two words, `Q1`/`mp3` not taken as pinyin, 〇, duplicate filled with later pinyin, several words per line, English only, HTML-shaped text; 40-line list | B |
| Teach Momo | confused then gets it, pinyin shown, "1 word" grammar, icon on button, end screen, one-word grammar; 4, 5 and 9 character words at 1280x720, 1366x768, 1280x800 and 390x844 through every step (listen, confused, gets it): button on screen, every character on screen, bubble never over the word, Momo never under the button, no page scroll, even lines in the word and the bubble, 2-3 character words on one line; sideways fit at phone and laptop | B |
| Karaoke | every 3rd word blank, three presses in one frame reveal once and move one word, end screen, New list fully resets, Stop halts, too-short list message, 5-character word fits and lights in reading order at phone and laptop width; 2-character word stays on one line; 9-character word, Momo and the button stay on screen at 1280x720 and 390x844 (singing and blank); every word a blank plays through | B |
| Comic | nothing overlaps (any bubble or character pair) with 2 to 12 character words over 3 shuffles at 320, 390 and 1280 width, no sideways scroll, empty print shows the plain message on 1 page, too-short and too-long lists handled (capped at 24), tap bubble then word, Shuffle highlights a bubble and the next tap replaces only it, icons, Letter and A4 print 1 page each, a 1 inch margin still prints 1 Letter page, after New list printing shows the plain message (no stale comic) | B |
| Tap targets | every visible button and the text box measured at 64 x 64 px or larger on 10 screens (phone and laptop) | B |
| Errors and network | no page or console errors; no request outside the local files | B |
| Remembered list | carries between the three files from local files in Chromium | B (Chromium), C (Safari) |

I also looked at every refreshed PNG by eye (self-check, not independent evidence).

Not verified (C): real phones and tablets, Safari/iOS (including Safari's support for the Letter/A4 `@page` switch), a classroom projector or smartboard, a real printer (only Chromium PDF output), Chinese fonts on Windows or Chromebook (falls back to a system Chinese font; Kaiti only on Mac).

## Review fixes (round 2)

| Reviewer item | Fix |
|---|---|
| Comic broken on laptop | Panels stack full width at every size (3-column layout removed) |
| Comic long words collide | Bubbles under half the panel each, text size by character count (CONFIG), wrapping |
| Teach and Karaoke long words overflow | Font fitted to the screen, long words split onto balanced lines (CONFIG `maxCharsPerLine`); karaoke lights per character |
| Pinyin lost for Sheets, Excel, CSV, slash | Reader pairs word and pinyin before splitting; identical in all 3 files, README says they must stay identical |
| Karaoke New list stale state | Full reset of chips, blanks, words, button and speed |
| Karaoke reveal double-fire | `revealing` flag, button disabled, one pending timer at a time |
| Report honesty | Laptop runs added, colours fully tokenised, Momo wording corrected, all B rows now backed by `check.py` and `check-receipt.txt` |
| Placeholder note and grammar | Note removed from every teacher and kid screen; "1 word" and one-word end screens fixed |
| Comic selection after Shuffle, empty print, tiny lists | Bubble stays highlighted, empty print shows a plain message, minimum 3 words |
| Word-count policy, literals | `minWords` / `maxWords` in every CONFIG with plain messages; long-word rule, blank mark, print margin in CONFIG |
| English-only buttons | Kept English per JJ's plain-English rule, added pictures to every main action, scoped as teacher-tapped; immersion question goes to JJ |
| Repo rules | README lists the waived rules (agent API, tests, demo video) and why |

## Round 3 fixes

| Reviewer item | Fix |
|---|---|
| Teach Momo button pushed off landscape screens (must-fix) | Word sized by width AND the height left above the bubble room, Momo and the button; faded bubble takes no space; Momo scales with screen height; check.py tests 4 screen sizes with 4, 5 and 9 character words at every step |
| Comic stale print after New list | New list clears the comic, so printing shows the plain message |
| Overlap check skipped bubble vs character | Check now tests every pair; report wording matches |
| Report said every should-fix was applied | Reworded; parser limits and the all-blank karaoke run are now stated (the run is in check.py) |
| 1 inch print margin gave 2 pages | Panel height worked out from paper and margin |
| Pinyin-first lines paired wrong | Lines that start with pinyin pair each word with the pinyin before it; remaining limit documented |
| Answer bubble lines uneven | Bubble uses the same even-line fit as the main word |

## Open questions for JJ

1. Kid-facing English: keep plain-English buttons with pictures, or move kid screens to Chinese or pictures only?
2. Teach Momo: Momo is confused exactly once per word, then gets it. Vary it? (`CONFIG.triesBeforeGotIt`)
3. Karaoke works on single words, so it reads like a word parade, not a song line. Add a sentence or chant field if kept?
4. Comic: keep the invented coral friend, or a named second character?
5. Momo's cheers mix Chinese (好棒！) and one English "Yes!". All Chinese?
