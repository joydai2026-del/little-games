# Avery printable page-fill convention (JD 2026-09-28)

**Status:** Pending JD approval of two sample mockups before any bulk Active-listing PDF rewrite / TPT re-upload.  
**Standing rule (unchanged):** never ship large empty bottoms — fill to near footer.

## Do not ship empty bottoms

If a printable page still has large empty space after core content, **always add an activity fill**. Do not grow a sentence band or a purple callout with `flex:1` white padding as a fake “fill.”

## Approved fill styles (samples required first)

Before changing all Active listings that still show empty bottoms, ship **two approved-style examples** and wait for JD confirm:

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

## Products already flagged (hold re-upload)

| Product | TPT id | Notes |
|---|---|---|
| Halloween Chinese Story Book | #17733981 | Enlarge art; shrink sentence band; fill with real activity, not flex padding |
| Halloween Chinese Writing (田字格 / 「南」 etc.) | #17734062 | Replace empty 说一说·写一写 with 看图写字 / 看图写句子 style fills |
| Halloween Chinese Activities | #17734157 | Audit same empty-bottom / fat-band pattern |
| Halloween Pumpkin Craft | #17774630 | Separate craft pack; only touch if same failure mode after samples approved |
| Other Halloween paid PDFs sharing the template | — | Same hold |

## Process

1. Parent shows JD the two mockups (看图写字 + 看图写句子).  
2. After JD approve → update factory sources under `avery-factory/products/` → rebuild PDFs → QA page PNGs → re-upload to TPT (cover + ≥3 previews; do not regress bilingual short descriptions).  
3. Push reusable notes here (`docs/avery/ops/`) per standing rule.

## Related

- Prior whitespace pass: `halloween-chinese-2026/QA-WHITESPACE-2026-09-24.md` (flex-grow approach — superseded for empty interiors).
