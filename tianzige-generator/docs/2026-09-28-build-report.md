# Tianzige Generator build report (2026-09-28, round 2)

Grades: **A** = verified on the live site AND recorded in the committed receipt
[`docs/evidence/2026-09-28-live-receipt.md`](evidence/2026-09-28-live-receipt.md) (R = receipt line);
**B** = proven in source or unit tests; **C** = not verified.

Live URL: https://tianzige-generator.joyd-ai-2026.workers.dev (workers.dev only; no custom domain).
Deployed version in the receipt: `7399fdfc-8ac0-4ff5-b25c-8d38d5fe802e`.

## What shipped

| Piece | Evidence | Grade |
|---|---|---|
| One-screen phone app: paste box, live preview, 4 options, Print, Save-as-PDF hint | R: app page 200; demo video; stills | A |
| Tap targets at least 64 px | R: 13 targets measured, smallest 160x64 | A |
| Print disabled from the first keystroke until the new sheet is drawn; paper CSS swaps with the pages | R: stale print guard True/True | A |
| Locked grid: ink model on 米字格 with 共N画, gray build-up, light-gray trace, empty cells, wrapping | Stills; render tests | A (look) / B (rules) |
| 米字格 diagonals dash-dot at 0.55x the cross, paler; default 田字格 | Render tests; stills | B |
| Words never split across a page break (unless one word is taller than a page) | R: 6 paper x row-width combos, 0 splits of words that fit; 画蛇添足 at 6 a row is taller than a page and starts a fresh page. Unit test sweeps an idiom across every boundary | A |
| Spare rows go to the characters with the most strokes | Unit test; A4 still (校 gets the extra row) | B |
| Letter and A4 print, no black lines, no English on the page but the brand | R: 612x792 and 595x842 pt, `check_pdf_ink` 0 black line paths, only Latin words Avery, Studio | A |
| Messy paste: headings dropped, PDF look-alikes normalized, one duplicate rule, input cut reported | R: `第三课 生字：` + ⼈ + 㐀 gives 3 characters; 11 real-paste fixtures + edge tests | A (that paste) / B (rules) |
| Agent path `POST /api/sheet` | R: messy paste 200 with X-Sheet headers; 40+ characters 200; text/plain 415; 120 KB body 413 | A |
| Body cap enforced while streaming, 5,000,001-character body refused | Unit test (413) | B |
| Stroke proxy: allowlist, pinned upstream, sha256, nosniff, cache headers | R: 大 龍 館 學 sha256 MATCH manifest; 㐀 404; 大人, a, ../ 400 | A |
| Upstream 64 KB cap while streaming; medians must be finite [x, y] pairs | Unit tests (a chunked 1 MB stream stops near 64 KB; 7 bad median shapes refused) | B |
| Own copy of the Arphic license | R: 200, sha256 MATCH the repo copy (which matches the npm tarball) | A |
| No pasted text reaches markup or an attribute | R: 0 `<img>` in the live preview, 0 `<script>`/`onerror` in the API sheet; dom.ts taint tests | A |
| Traditional characters, never converted | R: 龍 館 學 served and verified | A |
| Demo video recorded on the live site | `docs/demo/tianzige-generator-demo.mp4` (21 s, 666 KB), `.gif` (7.6 MB, 6 fps); frames checked | A |

Tests: 64 passing (`npm test`), typecheck clean (client + worker), `check:xss` clean.

## What changed after the review panel (both FIX-FIRST)

| Review item | Fix |
|---|---|
| Words split across pages | Paginate by word; split only a word taller than a page |
| No body cap / any content type on `/api/sheet` | 415 unless JSON, 413 over 32 KB (declared or streamed) |
| Medians check not real; cap after full read | Finite [x, y] pairs per stroke; cap enforced while streaming |
| Headings became practice characters | Heading rules in `parse.ts`, 5+ real heading lines tested |
| Stale print | Print disabled on keystroke until the matching render commits |
| Tap targets 44-55 px | 64 px minimum |
| STYLE-LOCK | Dash-dot diagonals at 0.55x, 共N画 label, 田字格 default; pinyin out (no source) |
| PDF look-alikes (⼈) | NFKC before parsing |
| Demo | Live-recorded mp4 + gif, embedded in both READMEs |
| Evidence | This regrade plus the receipt script and receipt |
| Should-fixes | One duplicate rule; hardest-first fill; input cut reported; palette via theme (momo.svg documented exception); render and worker numbers moved to config; setAttribute taint tests |

## Placeholders

- **Momo is a placeholder**: `public/momo.svg`, hand-drawn ink drop. Swap that one file.
- Grid colour is brand mint (`--grid-border`), one token to change.
- The mp4 needs its GitHub user-attachments URL; both READMEs hold a marked placeholder line.

## Open questions for JJ

1. Grid line colour: brand mint (now) or textbook red?
2. 共N画 always uses 画 (simplified). OK, or wait for a script source to write 共八畫 on traditional lists?

## Not verified

- Safari / iPad and Firefox printing (C). No WebKit here; the `<use>` CSS rules are ancestor-free,
  which is the spec-safe form, but only Chromium printing is proven.
- Rate limiter under load (C).
- `hanzi_svg.py` may place glyphs about 10% low in the Avery print engine (B, from reading its viewBox).

## Dependencies

No new npm packages. Runtime data `hanzi-writer-data@2.0.1`, pinned by the committed sha256 manifest;
both safety-scan rounds WARN, every required mitigation applied.
