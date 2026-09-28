# 田字格 Writing Sheets

An Avery Studio classroom tool for Mandarin immersion K-5. A teacher pastes characters (messy is
fine), sees the practice sheet right away, and prints it.

**Live:** https://tianzige-generator.joyd-ai-2026.workers.dev

## Demo

Recorded on the live site with `scripts/record-demo.py` (2026-09-28, silent): a messy list with a
heading is pasted, the heading is dropped, options change, and the sheet scrolls by.

![Tianzige Generator demo: paste a messy list, get a practice sheet](docs/demo/tianzige-generator-demo.gif)

<!-- mp4 user-attachments URL: pending, commander adds -->

Source files: [mp4](docs/demo/tianzige-generator-demo.mp4), [gif](docs/demo/tianzige-generator-demo.gif).
Stills: [phone](docs/demo/tianzige-phone.png), [phone preview](docs/demo/tianzige-phone-preview.png),
[print Letter 田字格](docs/demo/tianzige-print-letter.png), [print A4 米字格](docs/demo/tianzige-print-a4.png)
(captured on the live site by `scripts/capture-stills.py`; the print stills are Chromium's real PDF
output, rasterized). Live checks with timestamps and exact responses:
[`docs/evidence/2026-09-28-live-receipt.md`](docs/evidence/2026-09-28-live-receipt.md).

## What one character row looks like

| Cell | What it shows |
|---|---|
| 1 | The finished character in solid ink, on a 米字格 (always, even on a 田字格 sheet), with 共N画 above it |
| 2 .. n+1 | The stroke build-up in gray: one more stroke per cell, once |
| next 0-3 | The whole character in light gray, to trace over (teacher picks how many) |
| the rest | Empty cells to write it alone, wrapping to more rows when needed |

Words (学校, 画蛇添足) stay together: a page breaks between words, never inside one, unless a single
word is taller than a whole page. Leftover space on each page becomes extra practice rows, given to
the characters with the most strokes first, so no page has a dead lower half. No English on the student page: only 姓名, 日期, and the
brand line at the foot.

## Messy paste rules

Anything that is not a Chinese character is a separator: numbering, punctuation, pinyin (with or
without tone marks), English glosses, emoji. A run of up to 4 characters written together stays
one word; a longer run (一二三四五六七) is treated as single characters.

- **Headings are dropped:** a short line ending in a colon (`我的家人：`), a heading label before a
  colon (`第三课 生字：校` keeps only 校), and a line made only of heading words (第N课 / 第N单元,
  生字, 生词, 词语, 课文, 练习, 听写, 写字, 姓名, 日期, with 本周 / 本课 / 今天 in front). The list
  lives in `src/shared/parse.ts`.
- **Duplicates, one rule:** a whole word that already appeared is dropped (first one wins).
  Characters inside different words are kept, so 学校 学生 gives 学 twice. A repeat inside one
  word (妈妈) gets one grid.
- **Copied from a PDF:** look-alike code points (Kangxi radicals like ⼈) are normalized (NFKC) to
  the standard character first.
- Simplified and traditional both work and are never converted. Up to 40 characters per sheet;
  past 4,000 pasted characters the rest is skipped, and Momo says how many.

## For AI agents (same output over HTTP)

```bash
curl -s -X POST https://tianzige-generator.joyd-ai-2026.workers.dev/api/sheet \
  -H 'Content-Type: application/json' \
  -d '{"chars": "1. 大 dà big\n2. 学校 xuéxiào", "options": {"grid": "tian", "trace": 2, "perRow": 8, "paper": "letter"}}' \
  -o sheet.html
```

Returns one standalone printable HTML page (inline SVG, inline CSS, no scripts). Open it and print,
or print it headlessly. The request must be `Content-Type: application/json` (else 415) and under
`SHEET_MAX_BODY_BYTES` (32 KB, else 413). Response headers: `X-Sheet-Pages`, `X-Sheet-Chars`,
`X-Sheet-Missing` (characters drawn without stroke order), `X-Sheet-Truncated`,
`X-Sheet-Input-Cut`; the character lists are percent-encoded UTF-8.

| Option | Values | Default |
|---|---|---|
| `grid` | `tian` (田字格), `mi` (米字格) | `tian` |
| `trace` | 0, 1, 2, 3 | 2 |
| `perRow` | 6, 8, 10 | 8 |
| `paper` | `letter`, `a4` | `letter` |

Anything else falls back to the default. `GET /api/strokes/<one character>` returns the verified
stroke JSON for one character (404 when there is none).

## Stroke data

From `hanzi-writer-data@2.0.1` (derived from Make Me a Hanzi), fetched per character by the Worker
from jsDelivr. The browser never calls the CDN. The Worker accepts only one character that is in the
pinned manifest (`src/worker/stroke-manifest.json`, 9,574 characters), caps the body at 64 KB while
streaming, checks its sha256 against the manifest, and checks its JSON shape (string strokes, one
list of finite [x, y] median points per stroke) before using it.

Character stroke data: Make Me a Hanzi / Arphic Technology, Arphic Public License
([license text](public/licenses/ARPHICPL.TXT), also served at `/licenses/ARPHICPL.TXT`).

## Develop

```bash
npm ci
npm test            # vitest
npm run typecheck
npm run check:xss   # no raw-markup APIs in client or shared code
npm run dev         # vite, UI only
npm run cf:dev      # build + wrangler dev, UI and API
npm run deploy      # build + deploy to workers.dev
python3 scripts/capture-stills.py   # re-capture docs/demo stills from the live site
python3 scripts/record-demo.py      # re-record the demo mp4 + gif from the live site
python3 scripts/live-receipt.py     # live checks -> docs/evidence/<date>-live-receipt.md
```

Where things live:

| Thing | File |
|---|---|
| Colors (only place; `momo.svg` image art is the one documented exception) | `public/theme.css` |
| Printed sheet styles | `public/sheet.css` |
| Layout numbers, teacher options, limits | `src/shared/config.ts` |
| Paste parsing | `src/shared/parse.ts` |
| The locked grid rules | `src/shared/layout.ts` |
| Sheet to SVG (used by browser and API) | `src/shared/render.ts` |
| Momo (placeholder art) | `public/momo.svg` |
| Cache times, size caps, rate limit, Retry-After | `wrangler.jsonc` |
