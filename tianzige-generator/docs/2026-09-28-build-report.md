# Tianzige Generator build report (2026-09-28, round 3)

Grades: **A** = verified on the live site AND recorded in the committed receipt
[`docs/evidence/2026-09-28-live-receipt.md`](evidence/2026-09-28-live-receipt.md) (R = receipt line);
**B** = proven in source or unit tests; **C** = not verified.

Live URL: https://tianzige-generator.joyd-ai-2026.workers.dev (workers.dev only; no custom domain).
Deployed version in the receipt: `218ab2a2-ec45-4679-8fc5-3be2ab2673a4`, the same before and after
the run, built from HEAD `dcd5218` (clean); every live asset's sha256 matches the local build.

## What shipped

| Piece | Evidence | Grade |
|---|---|---|
| One-screen phone app: paste box, live preview, 4 options, Print, Save-as-PDF hint | R: app page 200; demo video; stills | A |
| Tap targets at least 64 px | R: 13 targets measured, smallest 160x64 | A |
| Print never enabled for a stale sheet, including during the 200 ms debounce | R: continuous per-frame sampling, strokes delayed 400 ms, keys 520-640 ms apart, 0 bad frames; deferred-promise unit test (proven red without the fix) | A |
| Locked grid: ink model on 米字格 with 共N画, gray build-up, light-gray trace, empty cells, wrapping | Stills; render tests | A (look) / B (rules) |
| 米字格 diagonals dash-dot at 0.55x the cross, paler; default 田字格 | Render tests; stills | B |
| Words never split across a page break when they fit on one page | R: 6 paper x row-width combos, 0 splits of words that fit. Unit test sweeps an idiom across every boundary | A |
| A word taller than a page runs onto the next page and Momo says so | R: 画蛇添足 at 6 a row (Letter and A4), Momo line present; `X-Sheet-Split-Words` header | A |
| Spare rows go to the characters with the most strokes | Unit test; A4 still (校 gets the extra row) | B |
| Letter and A4 print, no black lines, no English on the page but the brand | R: 612x792 and 595x842 pt, `check_pdf_ink` 0 black line paths, only Latin words Avery, Studio | A |
| Headings skipped by shape only and always reported; vocabulary never dropped | R: `学校：\nschool` gives 学校; `学校 练习 日期 姓名` keeps all 4; `第三课 生字：校` gives 生字 校, skipped ["第三课"]; Momo names skipped headings | A |
| Numerals separated by 、 stay vocabulary (`一、二、三、四、五`, `一、\n二、\n三、`); a colon heading needs a short line and Chinese on the NEXT line (`学校：\nschool\n老师：\nteacher` keeps both); `X-Sheet-Skipped` capped at 2 KB with "+N more" | R: 一二三四五; 一二三; 学校老师; unit test for the cap | A / B (cap) |
| Textbook layout `一、生字：` / `二、词语：` over lists: labels skipped and reported; `㊀\n㊁\n㊂` gives 一二三 | R: 大小多学校老师, skipped [生字, 词语]; 一二三 | A |
| List markers stripped at line start; a list item is never a heading; enclosed ideographs elsewhere normalize | R: 生字 大 小 山 水; `1. 第五课` / `一、第六课` / `• 第七课` all kept, skipped []; `我爱㊀ ㊊ ㊥` gives 我爱一 月 中 | A |
| PDF look-alikes normalized, one duplicate rule, input cut reported | R: ⼈ becomes 人; unit tests | A / B |
| Agent path `POST /api/sheet` | R: messy paste 200 with X-Sheet headers; 40+ characters 200; text/plain 415; 120 KB body 413 | A |
| Body cap enforced while streaming, 5,000,001-character body refused | Unit test (413) | B |
| Stroke proxy: allowlist, pinned upstream, sha256, nosniff, cache headers | R: 大 龍 館 學 sha256 MATCH manifest; 㐀 404; 大人, a, ../ 400 | A |
| Upstream 64 KB cap while streaming; medians must be finite [x, y] pairs | Unit tests (a chunked 1 MB stream stops near 64 KB; 7 bad median shapes refused) | B |
| Own copy of the Arphic license | R: 200, sha256 MATCH the repo copy (which matches the npm tarball) | A |
| No pasted text reaches markup or an attribute | R: 0 `<img>` in the live preview, 0 `<script>`/`onerror` in the API sheet; dom.ts taint tests | A |
| Traditional characters, never converted | R: 龍 館 學 served and verified | A |
| Demo video recorded on the live site | `docs/demo/tianzige-generator-demo.mp4` (21 s, 666 KB), `.gif` (7.6 MB, 6 fps); frames checked | A |

Tests: 79 passing (`npm test`), typecheck clean (client + worker), `check:xss` clean.

## What changed after the review panel (both FIX-FIRST)

| Review item | Fix |
|---|---|
| Words split across pages | Paginate by word; split only a word taller than a page |
| No body cap / any content type on `/api/sheet` | 415 unless JSON, 413 over 32 KB (declared or streamed) |
| Medians check not real; cap after full read | Finite [x, y] pairs per stroke; cap enforced while streaming |
| Headings became practice characters | Heading rules in `parse.ts`, 5+ real heading lines tested |
| Stale print | Print disabled on keystroke until the matching render commits |
| Tap targets 44-55 px | 64 px minimum |
| STYLE-LOCK | Dash-dot diagonals at 0.55x, 共N画 label, 田字格 default; pinyin is an open WHAT for JJ (plan) |
| PDF look-alikes (⼈) | NFKC before parsing |
| Demo | Live-recorded mp4 + gif, embedded in both READMEs |
| Evidence | This regrade plus the receipt script and receipt |
| Should-fixes | One duplicate rule; hardest-first fill; input cut reported; palette via theme (momo.svg documented exception); render and worker numbers moved to config; setAttribute taint tests |

## Placeholders

- **Momo is a placeholder**: `public/momo.svg`, hand-drawn ink drop. Swap that one file.
- Grid colour is brand mint (`--grid-border`), one token to change.
- The mp4 needs its GitHub user-attachments URL; both READMEs hold a marked placeholder line.

## Round 3 (review round 2) changes

| Review item | Fix |
|---|---|
| Heading rule over-dropped vocabulary | Shape-only rule (第N课 / 第N单元; colon line over more Chinese lines), skipped list shown by Momo and returned by the API |
| Print re-enabled during the debounce | Controller bumps the render token on every keystroke; deferred-promise test; receipt samples every frame |
| Receipt not bound to a commit | HEAD, clean-tree check, local-vs-live asset hashes, deployment sampled before and after |
| "Starts a fresh page" wording | Fixed in README, plan, layout comment, receipt; Momo reports words that run onto the next page |
| Pinyin | Not built; open WHAT for JJ in the plan (CC-CEDICT path in the Bilingual Vocab Game repo) |
| List numbering | Stripped, tested |

## Open questions for JJ

0. Pinyin on these sheets (see plan, "Open WHAT for JJ").
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
