# Tianzige Generator plan (2026-09-28)

## What

A one-screen web tool: paste Chinese characters, see a 田字格 practice sheet update live, print it
(or save as PDF). The same sheet is available to AI agents at `POST /api/sheet`. One Cloudflare
Worker serves the static app and a two-route API. No accounts, no storage, no tracking.

## Config surface

| Where | What |
|---|---|
| `src/shared/config.ts` `Options` (teacher) | grid 田/米, trace cells 0-3, boxes per row 6/8/10, paper Letter/A4 |
| `src/shared/config.ts` `LAYOUT` | cell size, row and word gaps, header and footer height, min empty cells, glyph inset, line weights, dash patterns |
| `src/shared/config.ts` `LIMITS` | 40 characters per sheet, 4,000 input characters, 4-character word runs |
| `src/shared/config.ts` `PAPERS` | page sizes and margins |
| `public/theme.css` | every color |
| `wrangler.jsonc` | stroke cache seconds, upstream size cap, `/api/sheet` rate limit |

The whole request is a plain JSON `SheetSpec` (`{version, chars, options}`), so a saved teacher
list later is just a stored spec.

## Layout rules ported from the Avery Studio print engine

From `STYLE-LOCK.md` and `scripts/hanzi/hanzi_svg.py` (`writing_grid`, `tian_zi_ge`, `glyph`):

- One grid per character. Cell 1 finished character in solid ink; cells 2..n+1 add one stroke each,
  once, in gray; then JJ's tool spec adds light-gray trace cells; then empty cells to the row end,
  wrapping across rows.
- Model cell on 米字格, practice cells on the teacher's pick.
- 米字格 diagonals quieter than the centre cross: dash-dot, 0.55x the centre-cross width, paler
  colour, drawn as filled rotated rects (the Chromium PDF black-cross bug), before the glyph.
  The 田字格/米字格 choice for practice cells stays a teacher option; the default is 田字格.
- Stroke count in Chinese numerals (共八画) above each reference cell, from the stroke data.
- Two-character words get two grids, kept together: pages break between words, never inside one,
  unless one word is taller than a whole page.
- No English on the student page; brand line at the foot.
- Page fill: leftover space on each page becomes extra empty rows, most-strokes characters first.

One deliberate difference: `hanzi_svg.py` sets the glyph viewBox to y -124..900. After its own
flip transform the ink sits in y 0..1024 (checked on 田: data y 92..717, flipped 183..808), so this
port uses 0..1024, which centres the glyph in the cell. Worth checking the print engine against a
printed page.

## Not ported, on purpose

- **Pinyin stays out.** STYLE-LOCK allows pinyin on the student page, but there is no pinned,
  safety-scanned pinyin source (hanzi-writer-data has none). No source, no toggle.
- 共八畫 (traditional 画): the label always uses 画. Telling simplified from traditional needs a
  script source too.

## Deferred
- Saved teacher lists and the paid tier: not built; the spec is serializable so they stay possible.
- Highlighted newest stroke, fonts beyond the system Kai fonts.
