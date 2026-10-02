# Avery printable page-fill convention (JD 2026-09-28)

**Status:** APPROVED 2026-09-28 (JD widget dismissed → proceed with BOTH Sample A + B). Applied to Halloween Writing/Story/Activities; expand storewide.  
**Standing rule (unchanged):** never ship large empty bottoms — fill to near footer.

## Do not ship empty bottoms

If a printable page still has large empty space after core content, **always add an activity fill**. Do not grow a sentence band or a purple callout with `flex:1` white padding as a fake “fill.”

## Approved fill styles (BOTH locked)

JD approved both styles. Apply storewide to Active Avery PDFs with large white bottoms:

### 1) 看图写字 · Look & write words

- Several small pictures
- Compound words that use the target character  
  Example for 「南」: 东南西北 · 南方 · 南京 · 南瓜
- Student write grids (田字格 / short answer lines) under each word

### 2) 看图写句子 · Look & write a sentence

- One picture
- Cloze sentence missing 1–2 characters to fill  
  Example: 我看见了___南瓜
- Compact; does not create a tall empty sentence band

## Anti-patterns (failed QA)

| Fail | Why |
|---|---|
| Fat middle “sentence box” with huge internal white (`flex:1` on `.reader-sent`) | Looks empty; art stays too small |
| Tall purple 「说一说·写一写」 with 2–3 underscore lines at top and empty lower half | Empty-bottom rule not met; lines look unprofessional when full-width |
| Measuring “pass” only by colored box reaching footer while interior is blank | JD still rejects |

## Products (apply / re-upload)

| Product | TPT id | Notes |
|---|---|---|
| Halloween Chinese Story Book | #17733981 | Enlarge art; shrink sentence band; fill with real activity, not flex padding |
| Halloween Chinese Writing (田字格 / 「南」 etc.) | #17734062 | Replace empty 说一说·写一写 with 看图写字 / 看图写句子 style fills |
| Halloween Chinese Activities | #17734157 | Audit same empty-bottom / fat-band pattern |
| Halloween Pumpkin Craft | #17774630 | Separate craft pack; only touch if same failure mode after samples approved |
| Other Halloween paid PDFs sharing the template | — | Audit + fill if empty bottoms |
| Pumpkin Craft | #17774630 | Fill only if same failure mode |

### Applied 2026-09-28 ET
- Writing #17734062 · Story #17733981 · Activities #17734157 rebuilt with Sample A+B fills under `avery-factory/products/halloween-chinese-2026/`.
- Shared helper: `shared/page_fill.py`.
- Samples: `/workspace/avery-ops/reports/layout-fill-samples-2026-09-28/`.
- Apply report: `/workspace/avery-ops/reports/layout-fill-apply-2026-09-28/`.

## Process

1. ~~Parent shows JD the two mockups~~ — APPROVED (both A + B).  
2. Update factory sources → rebuild PDFs → QA page PNGs (empty-bottom detector ≤0.9in) → re-upload to TPT (cover + ≥3 previews; do not regress bilingual short descriptions).  
3. Push reusable notes here (`docs/avery/ops/`) per standing rule.  
4. Expand to other Active listings with empty bottoms.

## Related

- Prior whitespace pass: `halloween-chinese-2026/QA-WHITESPACE-2026-09-24.md` (flex-grow approach — superseded for empty interiors).

### Applied batch 2 — 2026-09-28 PM ET
Storewide empty-bottom audit + Sample A/B fills on remaining Active priority PDFs:

| Product | TPT id | Notes |
|---|---|---|
| Halloween Chinese Activities (p6 densify) | #17734157 | Re-submitted cover+≥3 previews |
| Halloween Chinese Vocab Pack | #17597831 | Restored factory source + SVG icons + A/B fills; emoji removed |
| FREE Halloween Chinese Vocab | #17597740 | Same |
| Thanksgiving Chinese Gratitude Vocab Pack | #17614375 | Circle/sentences/bingo/teacher filled |
| FREE Thanksgiving Chinese Gratitude Vocab | #17613095 | Sentences page filled |
| Mid-Autumn Lantern / Mooncake / Jade Rabbit crafts | #17711359 / #17711456 / #17711532 | Live PDF swapped to denser v2 (compressed); craft cut-template white remains intentional |
| Halloween Pumpkin Craft | #17774630 | Still deferred (intentional craft white) |

Shared helpers:
- HTML: `avery-factory/products/halloween-chinese-2026/shared/page_fill.py`
- SVG vocab packs: `avery-factory/scripts/hanzi/page_fill_svg.py`
- Empty-bottom detector audit: `/workspace/avery-ops/reports/empty-bottom-audit-2026-09-28/`

Soft remains (cover / TOC / teacher-only): acceptable; content student pages ≤0.9in empty-bottom PASS.
