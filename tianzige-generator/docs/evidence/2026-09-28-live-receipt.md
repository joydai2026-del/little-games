# Live receipt, 2026-09-28

Written by `scripts/live-receipt.py` against **https://tianzige-generator.joyd-ai-2026.workers.dev**, 2026-09-28T17:30:10Z to 2026-09-28T17:30:45Z.

## Source

HEAD `c5e5f0cb16a523ef8c7b765773579608728680f5`; uncommitted changes in tianzige-generator/: 
M tianzige-generator/docs/demo/tianzige-generator-demo.gif
 M tianzige-generator/docs/demo/tianzige-generator-demo.mp4
 M tianzige-generator/docs/demo/tianzige-phone-preview.png
 M tianzige-generator/docs/demo/tianzige-phone.png
 M tianzige-generator/docs/evidence/2026-09-28-live-receipt.md

## Deployed version (`wrangler deployments status`)

Before the run:

```
⛅️ wrangler 4.128.0 (update available 4.143.0)
───────────────────────────────────────────────
Created:     2026-09-28T17:29:31.108Z
Author:      joyd.ai.2026@gmail.com
Source:      Unknown (deployment)
Message:     -
Version(s):  (100%) 115666b7-41a5-48c0-bf6e-f5275e91ac88
                 Created:  2026-09-28T17:29:30.300Z
                     Tag:  -
                 Message:  -
```

After the run:

```
⛅️ wrangler 4.128.0 (update available 4.143.0)
───────────────────────────────────────────────
Created:     2026-09-28T17:29:31.108Z
Author:      joyd.ai.2026@gmail.com
Source:      Unknown (deployment)
Message:     -
Version(s):  (100%) 115666b7-41a5-48c0-bf6e-f5275e91ac88
                 Created:  2026-09-28T17:29:30.300Z
                     Tag:  -
                 Message:  -
```

## Live assets vs the local build of HEAD

| file | local sha256 | live sha256 | result |
|---|---|---|---|
| `/index.html` | 0cdc4ce6537a2bfc... | 0cdc4ce6537a2bfc... | MATCH |
| `/momo.svg` | d94bd2e0451294f1... | d94bd2e0451294f1... | MATCH |
| `/sheet.css` | 016a6b640ad57460... | 016a6b640ad57460... | MATCH |
| `/theme.css` | 12ea26e4bbe736e8... | 12ea26e4bbe736e8... | MATCH |
| `/licenses/ARPHICPL.TXT` | 5590533436c70f10... | 5590533436c70f10... | MATCH |
| `/assets/index-B210hQyk.js` | f264e0f313bf061c... | f264e0f313bf061c... | MATCH |
| `/assets/index-CrL0xQO-.css` | 7694a5bfe2bed3fc... | 7694a5bfe2bed3fc... | MATCH |

## HTTP checks

| time (UTC) | check | request | status | bytes | headers | result |
|---|---|---|---|---|---|---|
| 2026-09-28T17:30:17Z | app page | `GET /` | 200 | 4415 | content-type: text/html; cache-control: public, max-age=0, must-revalidate | contains Paste box: True |
| 2026-09-28T17:30:17Z | stroke proxy 大 | `GET /api/strokes/%E5%A4%A7` | 200 | 1034 | content-type: application/json; charset=utf-8; cache-control: public, max-age=604800; x-content-type-options: nosniff | sha256 83c82950e903c915... manifest MATCH |
| 2026-09-28T17:30:17Z | stroke proxy 龍 | `GET /api/strokes/%E9%BE%8D` | 200 | 4408 | content-type: application/json; charset=utf-8; cache-control: public, max-age=604800; x-content-type-options: nosniff | sha256 be9f287493f4c785... manifest MATCH |
| 2026-09-28T17:30:18Z | stroke proxy 館 | `GET /api/strokes/%E9%A4%A8` | 200 | 4527 | content-type: application/json; charset=utf-8; cache-control: public, max-age=604800; x-content-type-options: nosniff | sha256 871723141b246f5c... manifest MATCH |
| 2026-09-28T17:30:19Z | stroke proxy 學 | `GET /api/strokes/%E5%AD%B8` | 200 | 4330 | content-type: application/json; charset=utf-8; cache-control: public, max-age=604800; x-content-type-options: nosniff | sha256 ab2653b570880be0... manifest MATCH |
| 2026-09-28T17:30:19Z | proxy reject 㐀 | `GET /api/strokes/%E3%90%80` | 404 | 45 | content-type: application/json; charset=utf-8; cache-control: public, max-age=86400; x-content-type-options: nosniff | {"error":"no stroke data for this character"} |
| 2026-09-28T17:30:19Z | proxy reject 大人 | `GET /api/strokes/%E5%A4%A7%E4%BA%BA` | 400 | 33 | content-type: application/json; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff | {"error":"one character, please"} |
| 2026-09-28T17:30:19Z | proxy reject a | `GET /api/strokes/a` | 400 | 33 | content-type: application/json; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff | {"error":"one character, please"} |
| 2026-09-28T17:30:20Z | proxy reject ..%2F..%2Fpackage.json | `GET /api/strokes/..%2F..%2Fpackage.json` | 400 | 33 | content-type: application/json; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff | {"error":"one character, please"} |
| 2026-09-28T17:30:20Z | license copy | `GET /licenses/ARPHICPL.TXT` | 200 | 6900 | content-type: text/plain; cache-control: public, max-age=0, must-revalidate | sha256 5590533436c70f10... repo copy MATCH |
| 2026-09-28T17:30:20Z | agent sheet, messy paste | `POST /api/sheet` | 200 | 77738 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 生字校大学校龍㐀人; x-sheet-input-cut: 0; x-sheet-missing: 㐀; x-sheet-pages: 3; x-sheet-skipped: ["第三课"]; x-sheet-split-words: []; x-sheet-truncated: false | ink-model cells: 8; <script: 0 |
| 2026-09-28T17:30:20Z | agent sheet, 40+ characters | `POST /api/sheet` | 200 | 279003 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 11; x-sheet-skipped: []; x-sheet-split-words: []; x-sheet-truncated: true |  |
| 2026-09-28T17:30:21Z | wrong content type | `POST /api/sheet` | 415 | 69 | content-type: application/json; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff | {"error":"send the request as JSON (Content-Type: application/json)"} |
| 2026-09-28T17:30:21Z | oversized body (120013 bytes) | `POST /api/sheet` | 413 | 62 | content-type: application/json; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff | {"error":"that request is too big; keep it under 32768 bytes"} |
| 2026-09-28T17:30:21Z | hostile paste via API | `POST /api/sheet` | 200 | 17468 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 大; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 1; x-sheet-skipped: []; x-sheet-split-words: []; x-sheet-truncated: false | <script: 0; onerror: 0; <img: 0 |
| 2026-09-28T17:30:21Z | parse: colon line, no Chinese after `'学校：\nschool'` | `POST /api/sheet` | 200 | 27538 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 学校; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 1; x-sheet-skipped: []; x-sheet-split-words: []; x-sheet-truncated: false |  |
| 2026-09-28T17:30:21Z | parse: vocabulary that looks like headings `'学校 练习 日期 姓名'` | `POST /api/sheet` | 200 | 75278 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 学校练习日期姓名; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 3; x-sheet-skipped: []; x-sheet-split-words: []; x-sheet-truncated: false |  |
| 2026-09-28T17:30:22Z | parse: lesson marker leading a line `'第三课 生字：校'` | `POST /api/sheet` | 200 | 29553 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 生字校; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 1; x-sheet-skipped: ["第三课"]; x-sheet-split-words: []; x-sheet-truncated: false |  |
| 2026-09-28T17:30:22Z | parse: list numbering `'一、生字 大\n（二）小\n㊀山\n㈡水'` | `POST /api/sheet` | 200 | 41288 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 生字大小山水; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 2; x-sheet-skipped: []; x-sheet-split-words: []; x-sheet-truncated: false |  |
| 2026-09-28T17:30:22Z | parse: list items that look like headings `'1. 第五课\n一、第六课\n• 第七课'` | `POST /api/sheet` | 200 | 86510 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 第五课第六课第七课; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 3; x-sheet-skipped: []; x-sheet-split-words: []; x-sheet-truncated: false |  |
| 2026-09-28T17:30:22Z | parse: numerals separated by 、 `'一、二、三、四、五'` | `POST /api/sheet` | 200 | 26125 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 一二三四五; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 1; x-sheet-skipped: []; x-sheet-split-words: []; x-sheet-truncated: false |  |
| 2026-09-28T17:30:22Z | parse: numeral-only lines `'一、\n二、\n三、'` | `POST /api/sheet` | 200 | 19923 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 一二三; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 1; x-sheet-skipped: []; x-sheet-split-words: []; x-sheet-truncated: false |  |
| 2026-09-28T17:30:22Z | parse: glossary with colons `'学校：\nschool\n老师：\nteacher'` | `POST /api/sheet` | 200 | 36098 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 学校老师; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 1; x-sheet-skipped: []; x-sheet-split-words: []; x-sheet-truncated: false |  |
| 2026-09-28T17:30:23Z | parse: textbook layout, numbered colon labels `'一、生字：\n大 小 多\n二、词语：\n学校 老师'` | `POST /api/sheet` | 200 | 53925 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 大小多学校老师; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 2; x-sheet-skipped: ["生字","词语"]; x-sheet-split-words: []; x-sheet-truncated: false |  |
| 2026-09-28T17:30:23Z | parse: enclosed numbers on their own lines `'㊀\n㊁\n㊂'` | `POST /api/sheet` | 200 | 19923 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 一二三; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 1; x-sheet-skipped: []; x-sheet-split-words: []; x-sheet-truncated: false |  |
| 2026-09-28T17:30:23Z | parse: parenthesised numbers on their own lines `'㈠\n小\n㈡\n大'` | `POST /api/sheet` | 200 | 22267 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 一小二大; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 1; x-sheet-skipped: []; x-sheet-split-words: []; x-sheet-truncated: false |  |
| 2026-09-28T17:30:23Z | parse: enclosed ideographs mid-line `'我爱㊀ ㊊ ㊥'` | `POST /api/sheet` | 200 | 43805 | content-type: text/html; charset=utf-8; cache-control: no-store; x-content-type-options: nosniff; content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; x-sheet-chars: 我爱一月中; x-sheet-input-cut: 0; x-sheet-missing: ; x-sheet-pages: 2; x-sheet-skipped: []; x-sheet-split-words: []; x-sheet-truncated: false |  |

## Browser checks (Chromium, 390x844, live site)

- 2026-09-28T17:30:28Z tap targets: 12 measured, smallest `田字格` 160x64 px
- 2026-09-28T17:30:29Z messy paste (heading, ⼈ U+2F08, 㐀, <img onerror>): Momo says "3 characters on 1 page. Ready to print! I skipped these headings: 第三课 生字. I don't know the stroke order for 㐀 yet, so it is drawn plain."; <img> in preview: 0
- 2026-09-28T17:30:35Z stale print guard, continuous: 351 frames sampled over 3 runs (gaps 520/580/640 ms, strokes delayed 400 ms); frames with Print enabled on a stale sheet: 0
- 2026-09-28T17:30:38Z words across page breaks, paste `大 小 山 水 火 木 学校 画蛇添足 老师 朋友 一心一意 春天`: letter/6: 9 pages, letter/8: 6 pages, letter/10: 5 pages, a4/6: 9 pages, a4/8: 6 pages, a4/10: 4 pages; words split that would fit on one page: none; words taller than a whole page, which run onto the next page by design: ['画蛇添足 (letter/6, pages [3, 4], Momo says so)', '画蛇添足 (a4/6, pages [3, 4], Momo says so)']
- 2026-09-28T17:30:39Z printed letter: 6 pages, 612 x 792 pts (letter); check_pdf_ink: `/var/folders/5x/7sj2fx9s0vq4jcjt2m6m44h80000gn/T/tmprqv_r1ps/letter.pdf: 0 black line paths` (exit 0); Latin words on the page: ['Avery', 'Studio']
- 2026-09-28T17:30:40Z printed a4: 6 pages, 594.96 x 841.92 pts (A4); check_pdf_ink: `/var/folders/5x/7sj2fx9s0vq4jcjt2m6m44h80000gn/T/tmpfswqdlpo/a4.pdf: 0 black line paths` (exit 0); Latin words on the page: ['Avery', 'Studio']
