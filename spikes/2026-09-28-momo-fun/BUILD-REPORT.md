# Build report: Momo fun spikes (Track D)

Date: 2026-09-28. Branch: `feat/momo-fun-spikes`. Folder: `spikes/2026-09-28-momo-fun/`. Nothing outside this folder was touched. Nothing deployed, no packages installed.

Evidence grades: A = proven in production, B = proven in source or in a headless browser run, C = not verified.

## What each spike does

| Spike | Flow | Grade |
|---|---|---|
| `teach-momo.html` | Paste list, Start. One word shows huge. Button cycles: "Teach Momo" (Momo leans in, "I'm listening...") then "I said it!" (1st tap: Momo tilts, wavy mouth, red "?", "Hmm? One more time!"; 2nd tap: Momo bounces twice with sparkles, bubble repeats the word plus pinyin if pasted, counter goes up) then "Next word". End screen: "Momo learned all N words!" with the word list, "Teach again". | B |
| `karaoke-blanks.html` | Paste list, Next. Word chips appear, every 3rd word pre-marked as a blank (tap to toggle). Speed: Slow / Normal / Fast. Play: a lyric strip scrolls along the top, the current word shows huge with a coral sweep highlight (CSS animation timed to the speed). At a blank: dashed "?" box, "Everybody, shout it!", Momo makes an "O" mouth, big "Show the word" button. Tap: word pops in, Momo jumps, cheer bubble (好棒！/ 对了！/ 太棒了！/ Yes!), song continues. End: "That's the song!" with count of words shouted. | B |
| `comic-bubbles.html` | Paste list, "Make the comic". 3 panels (Momo alone; Momo + coral friend; friend + Momo), 5 dashed "tap me" bubbles. Tap a bubble (it glows), tap a word in the tray; selection hops to the next empty bubble so kids can keep tapping words. Shuffle fills every bubble at random. "Empty the bubbles" resets. Print with a Letter / A4 switch: prints only the comic plus "Act it out! Name: ____", empty bubbles stay blank for writing. | B |

Shared across all three: same paste parser (strips numbering like `1.`, `3、`, `4)`; splits on commas, 、, semicolons, slashes, tabs, new lines; keeps Chinese; keeps pinyin only when tone-marked or tone-numbered; drops English; removes duplicates), same inline Momo SVG (placeholder), palette tokens as CSS variables, tunable values in a `CONFIG` block, motion by CSS only, system fonts only (no network requests at all), `prefers-reduced-motion` respected, localStorage wrapped in try/catch.

## Screenshots (phone width 390 px, 2x)

| File | Shows |
|---|---|
| `shots/teach-momo.png` | Momo just learned 苹果, bubble with 苹果 / píngguǒ, sparkles, counter "1 word" |
| `shots/teach-momo-confused.png` | First "I said it!": Momo confused |
| `shots/karaoke-setup.png` | Chips with 西瓜 and 橙子 as blanks, Fast selected |
| `shots/karaoke-singing.png` | 苹果 mid-sweep |
| `shots/karaoke-blank.png` | Blank: "?" box, "Everybody, shout it!" |
| `shots/karaoke-blanks.png` | 西瓜 revealed, Momo cheering 太棒了！ |
| `shots/comic-bubbles.png` / `comic-bubbles-top.png` | 3 panels with 苹果, 西瓜, 橙子 placed, one bubble selected, word tray |
| `shots/comic-print-letter.png` / `comic-print-a4.png` | Printed page, 1 page each on Letter and A4 |
| `shots/review-board.png` | The review board with Keep / Change / Cut under each figure |

Test list used (typed by hand, real Chinese, deliberately messy): `1. 苹果 píngguǒ apple`, `2. 香蕉 xiāngjiāo banana`, `3、西瓜 (xīguā) watermelon`, `4) 葡萄 - pútao - grapes`, `草莓, 橙子`.

## Verified in a headless browser (Playwright, Chromium, phone viewport, audio stubbed)

| Check | Result | Grade |
|---|---|---|
| Parser output on the messy list | 6 words, pinyin kept for the 4 lines that had it, English dropped | B |
| Teach Momo full run | confused after 1st tap, "gotit" after 2nd, counter 1, end screen "Momo learned all 6 words!" | B |
| Karaoke full run (Fast) | chips 西瓜 and 橙子 as blanks, both reveals worked, end screen "6 words, 2 shouted by the class." | B |
| Comic | tap-bubble-then-word fills correctly, Shuffle fills all 5, print PDF = 1 page on Letter and 1 page on A4 (checked with pdfinfo, looked at the rendered pages) | B |
| Tap targets | no visible button under 64 x 64 px on the opening screens; all other buttons are styled with 64 px minimums | B (opening screens measured), C (other screens measured by CSS only) |
| JS errors / console errors | none across all runs | B |
| Remembered list carries between spikes | yes in Chromium from local files | B (Chromium only), C (Safari, iPad) |
| review.html | Keep / Change / Cut buttons and note box rendered under all 3 figures, plus "Export feedback"; no errors | B |
| I looked at every PNG | yes; fixed two issues found this way (karaoke cheer bubble clipped off-screen, then overlapping Momo) | B |

Not verified (C): real phones and tablets, Safari/iOS, a classroom projector, printing from a real printer (only Chromium PDF output), Chinese fonts on Windows/Chromebook (falls back to system Chinese font; Kaiti only on Mac).

## Open questions for JJ

1. Teach Momo: Momo is confused exactly once per word, then gets it. Should it vary (sometimes gets it first try, sometimes asks twice)? The number is in `CONFIG`.
2. Karaoke works on single words, so it reads like a word parade, not a song line. Is a sentence or chant field in the paste box wanted if this is kept?
3. Comic: a coral round "friend" character was invented as Momo's scene partner. Keep, or should there be a named second character?
4. Momo's cheers mix Chinese (好棒！) and one English "Yes!". All Chinese instead?
5. Codex review was not run inside this track (time box). The repo rule says Codex reviews before JJ sees it, so the parent should run it on the draft PR before handing over.
