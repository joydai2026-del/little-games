# Tianzige Generator build report (2026-09-28)

Grades: A = verified on the live site, B = proven in source or tests, C = not verified.

## What shipped

| Piece | Status | Grade |
|---|---|---|
| One-screen phone-first app: paste box, live preview, 4 plain-word options, Print button, Save-as-PDF hint | Live | A |
| Locked grid: ink model on 米字格, gray stroke build-up, light-gray trace cells, empty cells, wrapping | Live, printed | A |
| Page fill (leftover space becomes practice rows), words kept together, pages break between characters | Printed PDFs show it | A |
| Letter and A4 print via `@page` | Both printed by Chromium from the live site: 612x792 pt and 595x842 pt | A |
| No black lines in the printed PDF (Avery Studio's `check_pdf_ink.py`) | 0 black line paths, Letter and A4 | A |
| Messy paste parsing (numbering, pinyin, English, punctuation, emoji, duplicates) | 8 real-paste fixtures + 5 edge tests | B |
| Agent path `POST /api/sheet` returning standalone printable HTML | curl on live, 40 characters -> 10 pages, 200 | A |
| Stroke proxy `/api/strokes/:char`: manifest allowlist, sha256 check, 64 KB cap, JSON shape check, `nosniff`, cache headers | Live headers checked; reject, hash-mismatch, size-cap and shape paths tested | A (headers, 400/404) / B (hash, cap, shape) |
| Own copy of the Arphic license at `/licenses/ARPHICPL.TXT`, credits line in app and API sheet | Live 200; sha256 matches the npm tarball | A |
| Character with no data: plain font glyph + Momo note, never a crash | Live: 㐀 drawn plain, Momo names it | A |
| Pasted markup cannot become DOM (`<img onerror>` paste) | Live: 0 `<img>` in the preview; `check:xss` clean | A |

Live URL: https://tianzige-generator.joyd-ai-2026.workers.dev (workers.dev only; no custom domain touched).

Tests: 46 passing (`npm test`), `npm run typecheck` clean (client + worker configs), `npm run check:xss` clean.

## Evidence

| What | Path |
|---|---|
| Phone view, live | `docs/demo/tianzige-phone.png` |
| Phone preview of the sheet, live | `docs/demo/tianzige-phone-preview.png` |
| Printed page 1, Letter, 田字格 (Chromium PDF, rasterized) | `docs/demo/tianzige-print-letter.png` |
| Printed page 1, A4, 米字格 | `docs/demo/tianzige-print-a4.png` |
| Capture script (live site, sound stubbed, `?silent=1`) | `scripts/capture-stills.py` |

I opened and looked at all four PNGs. The first capture after moving grid cells into `<defs>/<use>`
printed every cell SOLID BLACK while all 45 tests were green (ancestor CSS selectors do not reach
`<use>` clones). Fixed, re-deployed, re-captured, and a test now pins it (proven red on the old CSS).

## Traditional characters

Pasted as-is, never converted. 龍, 館 and 學 all have stroke data and render with build-up
(live `/api/sheet`, `X-Sheet-Missing` empty): grade A for those three. The manifest has 9,574
characters (simplified and many traditional); a traditional character outside it gets the plain
font glyph and the Momo note (grade B from the manifest, 㐀 shown live). 学 and 學 are treated as
two different characters, which is right for a teacher who pasted one on purpose.

## Placeholders

- **Momo is a placeholder**: `public/momo.svg` is a hand-drawn ink drop (two eyes, smile, coral
  cheeks). No canonical Momo art exists. Swap that one file; nothing else references the art.
- Grid color is brand mint (`--grid-border` in `theme.css`). Textbooks use red or green; one token
  to change.

## Open questions for JJ (WHAT decisions)

1. A heading pasted with the list (like 第三课 生字) is Chinese, so it becomes practice characters.
   Keep that (teacher deletes the heading), or try to detect headings?
2. Grid line color: brand mint (now) or textbook red?
3. Demo video: the repo rule says every game ships an mp4+gif. This is a tool; I shipped stills
   only. Want a recorded video too?
4. Pinyin: hanzi-writer-data has none, so there is no pinyin toggle. Adding it needs a new pinned
   pinyin source (and its own safety scan).

## Findings worth a look

- `hanzi_svg.py` (the Avery Studio print engine) uses a glyph viewBox of y -124..900. After its own
  flip the ink sits in 0..1024 (田: data y 92..717, flipped 183..808), so its glyphs may sit about
  10% low in the cell. This port uses 0..1024 and the printed stills show centred glyphs. Grade B;
  worth checking a printed page of the Chinese writing packs.
- The browser logs one 404 per character with no stroke data (expected, harmless).

## Dependencies

No new npm packages (same devDependencies and lockfile versions as caption-wars). Runtime data:
`hanzi-writer-data@2.0.1` JSON from jsDelivr, fetched by the Worker, pinned by the committed
sha256 manifest. Safety scan: round 1 (Claude) WARN and round 2 (Codex) WARN, both with required
mitigations; all of them are applied (allowlist, pinned upstream, sha256, size cap, shape check,
nosniff, own license copy). The hanzi-writer script itself is not used.

## Not done / next

- Codex review of this PR (house rule before JJ sees it) has not run in this track.
- Saved teacher list and paid tier: not built; `SheetSpec` is plain JSON so both stay possible.
