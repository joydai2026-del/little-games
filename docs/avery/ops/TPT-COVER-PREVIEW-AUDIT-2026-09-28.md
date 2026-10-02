# TPT Cover + Preview Audit — 2026-09-28

**Store:** Avery Studio  
**Hard rule:** Never leave Active without cover image AND ≥3 preview images.  
**Audited:** ~4:05–4:28 PM ET  
**Method:** Storefront scrape (74 unique Active listings) + public product page CDN size check (`original-*-N.jpg` ≥10KB = real).  

## Summary

| Metric | Count |
|---|---:|
| Active on storefront | 74 |
| OK after fixes (cover + ≥3 previews) | 74 |
| Still missing | 0 |
| Fixed this run | 5 |

### Fixed this run

| Product ID | Title | Before | After |
|---|---|---|---|
| 17774630 | Halloween Pumpkin Craft & Coloring | gray placeholder, 0 real previews | cover + 4 previews (CDN 21/24/14/15 KB) |
| 17597005 | FREE Chinese Strokes Practice | cover only (1) | cover + 4 |
| 17597740 | FREE Halloween Chinese Vocab | cover only (1) | cover + 4 |
| 17597831 | Halloween Chinese Vocab Pack | cover only (1) | cover + 4 |
| 17599684 | FREE Chinese Radicals Sampler | cover only (1) | cover + 4 |

### Pumpkin evidence

- Public: https://www.teacherspayteachers.com/Product/Halloween-Pumpkin-Craft-Coloring-Chinese-K-5-17774630
- Before: `tpt-cover-audit-2026-09-28/BEFORE-pumpkin-public.png`, `BEFORE-pumpkin-og.jpg` (5 KB placeholder)
- After: `AFTER-pumpkin-public.png`, `AFTER-pumpkin-og.jpg` (real Avery cover)
- Result JSON: `fix-pumpkin-result-v4.json`

## Full table

| product id | title | Active? | cover? | preview count | public URL | action taken / still missing |
|---|---|---|---|---:|---|---|
| 16055350 | Chinese-Picture-Writing-5-Everyday-Scenes-Comic-Writing-Prompts-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Picture-Writing-5-Everyday-Scenes-Comic-Writing-Prompts-K-5-16055350 | OK |
| 16194192 | AI-Image-Prompt-Playbook-for-Teachers-25-Classroom-Visual-Prompts | yes | yes | 4 | https://www.teacherspayteachers.com/Product/AI-Image-Prompt-Playbook-for-Teachers-25-Classroom-Visual-Prompts-16194192 | OK |
| 16196860 | AI-Image-Prompt-Playbook-Volume-2-25-Reading-Writing-Poster-Prompts | yes | yes | 4 | https://www.teacherspayteachers.com/Product/AI-Image-Prompt-Playbook-Volume-2-25-Reading-Writing-Poster-Prompts-16196860 | OK |
| 16273538 | AI-End-of-Year-Teacher-Toolkit-Report-Card-Comments-Emails-Awards | yes | yes | 4 | https://www.teacherspayteachers.com/Product/AI-End-of-Year-Teacher-Toolkit-Report-Card-Comments-Emails-Awards-16273538 | OK |
| 17359711 | Back-to-School-AI-Prompts-for-Teachers-K-5-30-Guided-Workflows | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Back-to-School-AI-Prompts-for-Teachers-K-5-30-Guided-Workflows-17359711 | OK |
| 17359747 | Back-to-School-ChatGPT-Image-Prompts-Classroom-Visual-Workflows-K-8 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Back-to-School-ChatGPT-Image-Prompts-Classroom-Visual-Workflows-K-8-17359747 | OK |
| 17359775 | Chinese-First-Week-Activities-First-Day-of-Chinese-Class-Mandarin-K-8 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-First-Week-Activities-First-Day-of-Chinese-Class-Mandarin-K-8-17359775 | OK |
| 17359799 | Mid-Autumn-Festival-Worksheets-Moon-Festival-Mooncake-Activities-Chine | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Mid-Autumn-Festival-Worksheets-Moon-Festival-Mooncake-Activities-Chinese-K-5-17359799 | OK |
| 17359827 | ChatGPT-Image-Prompts-for-Chinese-Teachers-K-8-15-Visual-Workflows | yes | yes | 4 | https://www.teacherspayteachers.com/Product/ChatGPT-Image-Prompts-for-Chinese-Teachers-K-8-15-Visual-Workflows-17359827 | OK |
| 17359971 | Chinese-Teacher-Fall-Bundle-K-8-First-Week-AI-Prompts-Mid-Autumn | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Teacher-Fall-Bundle-K-8-First-Week-AI-Prompts-Mid-Autumn-17359971 | OK |
| 17388290 | Chinese-Newcomer-Communication-Board-ESL-ELL-Visual-Need-Cards-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Newcomer-Communication-Board-ESL-ELL-Visual-Need-Cards-K-5-17388290 | OK |
| 17432234 | Emergent-Reader-Level-A-I-Like-the-Cold-Penguin-Read-Aloud-Book-K-1 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Emergent-Reader-Level-A-I-Like-the-Cold-Penguin-Read-Aloud-Book-K-1-17432234 | OK |
| 17432247 | That-Is-Not-Mom-Emergent-Reader-Level-A-Partner-Read-Aloud-Speech-Bubb | yes | yes | 4 | https://www.teacherspayteachers.com/Product/That-Is-Not-Mom-Emergent-Reader-Level-A-Partner-Read-Aloud-Speech-Bubbles-17432247 | OK |
| 17437236 | Emergent-Reader-Level-A-I-Like-the-Sun-Turtle-Read-Aloud-Book-K-1 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Emergent-Reader-Level-A-I-Like-the-Sun-Turtle-Read-Aloud-Book-K-1-17437236 | OK |
| 17437252 | -Chinese-Emergent-Reader-K-1-I-Like-the-Sun | yes | yes | 4 | https://www.teacherspayteachers.com/Product/-Chinese-Emergent-Reader-K-1-I-Like-the-Sun-17437252 | OK |
| 17437269 | -Chinese-Emergent-Reader-K-1-I-Like-the-Cold | yes | yes | 4 | https://www.teacherspayteachers.com/Product/-Chinese-Emergent-Reader-K-1-I-Like-the-Cold-17437269 | OK |
| 17437295 | That-Is-Not-Your-Nose-Emergent-Reader-Level-A-Read-Aloud-Speech-Bubble | yes | yes | 4 | https://www.teacherspayteachers.com/Product/That-Is-Not-Your-Nose-Emergent-Reader-Level-A-Read-Aloud-Speech-Bubbles-17437295 | OK |
| 17437306 | -Chinese-Emergent-Reader-K-1-That-Is-Not-Your-Nose | yes | yes | 4 | https://www.teacherspayteachers.com/Product/-Chinese-Emergent-Reader-K-1-That-Is-Not-Your-Nose-17437306 | OK |
| 17437324 | -Chinese-Emergent-Reader-K-1-That-Is-Not-Mom | yes | yes | 4 | https://www.teacherspayteachers.com/Product/-Chinese-Emergent-Reader-K-1-That-Is-Not-Mom-17437324 | OK |
| 17447001 | Emergent-Reader-Level-A-I-Like-the-Rain-Frog-Read-Aloud-Book-K-1 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Emergent-Reader-Level-A-I-Like-the-Rain-Frog-Read-Aloud-Book-K-1-17447001 | OK |
| 17447018 | -Chinese-Emergent-Reader-K-1-I-Like-the-Rain | yes | yes | 4 | https://www.teacherspayteachers.com/Product/-Chinese-Emergent-Reader-K-1-I-Like-the-Rain-17447018 | OK |
| 17447062 | That-Is-Not-Your-Snack-Emergent-Reader-Level-A-Read-Aloud-Speech-Bubbl | yes | yes | 4 | https://www.teacherspayteachers.com/Product/That-Is-Not-Your-Snack-Emergent-Reader-Level-A-Read-Aloud-Speech-Bubbles-17447062 | OK |
| 17447077 | -Chinese-Emergent-Reader-K-1-That-Is-Not-Your-Snack | yes | yes | 4 | https://www.teacherspayteachers.com/Product/-Chinese-Emergent-Reader-K-1-That-Is-Not-Your-Snack-17447077 | OK |
| 17478370 | Chinese-Writing-Practice-Family-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Practice-Family-Stroke-Order-K-5-17478370 | OK |
| 17478397 | Chinese-Writing-Practice-Numbers-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Practice-Numbers-Stroke-Order-K-5-17478397 | OK |
| 17478460 | Chinese-Writing-Practice-Food-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Practice-Food-Stroke-Order-K-5-17478460 | OK |
| 17478510 | Chinese-Writing-Practice-Action-Verbs-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Practice-Action-Verbs-Stroke-Order-K-5-17478510 | OK |
| 17478559 | Chinese-Writing-Practice-Colors-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Practice-Colors-Stroke-Order-K-5-17478559 | OK |
| 17478611 | Chinese-Writing-Practice-Animals-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Practice-Animals-Stroke-Order-K-5-17478611 | OK |
| 17478654 | Chinese-Writing-Practice-School-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Practice-School-Stroke-Order-K-5-17478654 | OK |
| 17478736 | Chinese-Writing-Practice-Body-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Practice-Body-Stroke-Order-K-5-17478736 | OK |
| 17478849 | Chinese-Writing-Practice-Weather-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Practice-Weather-Stroke-Order-K-5-17478849 | OK |
| 17478941 | Chinese-Writing-Practice-Greetings-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Practice-Greetings-Stroke-Order-K-5-17478941 | OK |
| 17479028 | All-About-Me-in-Chinese-Mandarin-Immersion-Back-to-School-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/All-About-Me-in-Chinese-Mandarin-Immersion-Back-to-School-K-5-17479028 | OK |
| 17479128 | Back-to-School-Chinese-First-Week-Mandarin-Immersion-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Back-to-School-Chinese-First-Week-Mandarin-Immersion-K-5-17479128 | OK |
| 17479253 | Back-to-School-Chinese-Bundle-Mandarin-Immersion-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Back-to-School-Chinese-Bundle-Mandarin-Immersion-K-5-17479253 | OK |
| 17486944 | Chinese-Radicals-Speech-Radical-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Radicals-Speech-Radical-Stroke-Order-K-5-17486944 | OK |
| 17487052 | Chinese-Radicals-Person-Radical-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Radicals-Person-Radical-Stroke-Order-K-5-17487052 | OK |
| 17487145 | Chinese-Radicals-Grass-Radical-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Radicals-Grass-Radical-Stroke-Order-K-5-17487145 | OK |
| 17487230 | Chinese-Radicals-Water-Radical-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Radicals-Water-Radical-Stroke-Order-K-5-17487230 | OK |
| 17487356 | Chinese-Radicals-Hand-Radical-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Radicals-Hand-Radical-Stroke-Order-K-5-17487356 | OK |
| 17487569 | Chinese-Radicals-Roof-Radical-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Radicals-Roof-Radical-Stroke-Order-K-5-17487569 | OK |
| 17487677 | Chinese-Radicals-Mouth-Radical-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Radicals-Mouth-Radical-Stroke-Order-K-5-17487677 | OK |
| 17487798 | Chinese-Radicals-Tree-Radical-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Radicals-Tree-Radical-Stroke-Order-K-5-17487798 | OK |
| 17487918 | Chinese-Radicals-Bundle-72-Characters-Stroke-Order-Writing-Practice-K- | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Radicals-Bundle-72-Characters-Stroke-Order-Writing-Practice-K-5-17487918 | OK |
| 17523009 | Chinese-Newcomer-Kit-Communication-Board-All-About-Me-First-Week-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Newcomer-Kit-Communication-Board-All-About-Me-First-Week-K-5-17523009 | OK |
| 17523048 | Chinese-Writing-Practice-Bundle-10-Themes-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Practice-Bundle-10-Themes-Stroke-Order-K-5-17523048 | OK |
| 17532516 | Chinese-Mid-Autumn-Festival-Worksheets-Change-Story-Book-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Mid-Autumn-Festival-Worksheets-Change-Story-Book-K-5-17532516 | OK |
| 17597005 | FREE-Chinese-Strokes-Practice-Basic-Stroke-Order-Worksheets-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/FREE-Chinese-Strokes-Practice-Basic-Stroke-Order-Worksheets-K-5-17597005 | FIXED 2026-09-28: uploaded cover+4 previews (was 1) |
| 17597740 | FREE-Halloween-Chinese-Vocab-Flashcards-and-Worksheets-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/FREE-Halloween-Chinese-Vocab-Flashcards-and-Worksheets-K-5-17597740 | FIXED 2026-09-28: uploaded cover+4 previews (was 1) |
| 17597831 | Halloween-Chinese-Vocab-Pack-Printable-Worksheets-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Halloween-Chinese-Vocab-Pack-Printable-Worksheets-K-5-17597831 | FIXED 2026-09-28: uploaded cover+4 previews (was 1) |
| 17599684 | FREE-Chinese-Radicals-Practice-Sampler-Worksheets-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/FREE-Chinese-Radicals-Practice-Sampler-Worksheets-K-5-17599684 | FIXED 2026-09-28: uploaded cover+4 previews (was 1) |
| 17610728 | Jade-Rabbit-Mid-Autumn-Reader-Moon-Festival-Chinese-Storybook-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Jade-Rabbit-Mid-Autumn-Reader-Moon-Festival-Chinese-Storybook-K-5-17610728 | OK |
| 17613095 | FREE-Thanksgiving-Chinese-Gratitude-Vocab-Flashcards-and-Worksheets-K- | yes | yes | 4 | https://www.teacherspayteachers.com/Product/FREE-Thanksgiving-Chinese-Gratitude-Vocab-Flashcards-and-Worksheets-K-5-17613095 | OK |
| 17614375 | Thanksgiving-Chinese-Gratitude-Vocab-Pack-K-5-Flashcards-Worksheets | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Thanksgiving-Chinese-Gratitude-Vocab-Pack-K-5-Flashcards-Worksheets-17614375 | OK |
| 17625142 | Chinese-Writing-Mini-Bundle-Numbers-Family-Greetings-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Mini-Bundle-Numbers-Family-Greetings-K-5-17625142 | OK |
| 17680418 | FREE-Mid-Autumn-Mooncake-Chinese-Vocab-Flashcards-Worksheets-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/FREE-Mid-Autumn-Mooncake-Chinese-Vocab-Flashcards-Worksheets-K-5-17680418 | OK |
| 17680508 | Chinese-Newcomer-Week-2-Survival-Phrases-Classroom-Communication-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Newcomer-Week-2-Survival-Phrases-Classroom-Communication-K-5-17680508 | OK |
| 17682532 | Chinese-Strokes-to-Radicals-Bridge-Workbook-Stroke-Order-K-5- | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Strokes-to-Radicals-Bridge-Workbook-Stroke-Order-K-5--17682532 | OK |
| 17688401 | Chinese-Writing-Study-Book-Vol1-Radical-Food-Stroke-Order-K-5- | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Study-Book-Vol1-Radical-Food-Stroke-Order-K-5--17688401 | OK |
| 17688451 | Chinese-Writing-Study-Book-Vol2-Radical-Family-Stroke-Order-K-5- | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Study-Book-Vol2-Radical-Family-Stroke-Order-K-5--17688451 | OK |
| 17688517 | Chinese-Writing-Study-Book-Vol3-Radical-Fruit-Stroke-Order-K-5- | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Study-Book-Vol3-Radical-Fruit-Stroke-Order-K-5--17688517 | OK |
| 17688579 | Chinese-Writing-Study-Book-Vol4-Radical-Sports-Stroke-Order-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Study-Book-Vol4-Radical-Sports-Stroke-Order-K-5-17688579 | OK |
| 17688637 | Chinese-Writing-Study-Book-Vol5-Radical-Weather-Stroke-Order-K | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Study-Book-Vol5-Radical-Weather-Stroke-Order-K-17688637 | OK |
| 17688687 | Chinese-Writing-Study-Book-5-Vol-Bundle-Themes-K-5- | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Chinese-Writing-Study-Book-5-Vol-Bundle-Themes-K-5--17688687 | OK |
| 17711359 | Mid-Autumn-Chinese-Paper-Lantern-Craft-Moon-Festival-K-5-Mandarin | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Mid-Autumn-Chinese-Paper-Lantern-Craft-Moon-Festival-K-5-Mandarin-17711359 | OK |
| 17711456 | Mid-Autumn-Mooncake-Craft-Coloring-Chinese-Moon-Festival-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Mid-Autumn-Mooncake-Craft-Coloring-Chinese-Moon-Festival-K-5-17711456 | OK |
| 17711532 | Mid-Autumn-Jade-Rabbit-Craft-Moon-Festival-Mandarin-Activity-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Mid-Autumn-Jade-Rabbit-Craft-Moon-Festival-Mandarin-Activity-K-5-17711532 | OK |
| 17712145 | Mid-Autumn-Festival-Mini-Bundle-Change-Jade-Rabbit-Worksheets-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Mid-Autumn-Festival-Mini-Bundle-Change-Jade-Rabbit-Worksheets-K-5-17712145 | OK |
| 17733981 | Halloween-Chinese-Story-Book-K-5-Mandarin | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Halloween-Chinese-Story-Book-K-5-Mandarin-17733981 | OK |
| 17734062 | Halloween-Chinese-Writing-K-5-Mandarin | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Halloween-Chinese-Writing-K-5-Mandarin-17734062 | OK |
| 17734157 | Halloween-Chinese-Activities-K-5-Mandarin | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Halloween-Chinese-Activities-K-5-Mandarin-17734157 | OK |
| 17739468 | Halloween-Chinese-Mini-Bundle-Story-Writing-Activities-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Halloween-Chinese-Mini-Bundle-Story-Writing-Activities-K-5-17739468 | OK |
| 17774630 | Halloween-Pumpkin-Craft-Coloring-Chinese-K-5 | yes | yes | 4 | https://www.teacherspayteachers.com/Product/Halloween-Pumpkin-Craft-Coloring-Chinese-K-5-17774630 | FIXED 2026-09-28: was placeholder; uploaded cover+4 previews; public verified |

## Failure mode (Pumpkin #17774630) — prevent recurrence

`publish_tpt.py` published Active **without** forcing thumbnail mode 2:

1. Form default / leftover state is often **radio1** = *Auto generate thumbnails from the product file* OR **radio3** = *Upload thumbnails later*.
2. Script only tried `#ItemGenerateThumbnail0` / value `0` (does not exist) and a best-effort thumb file input — **never** reliably clicked `#ItemGenerateThumbnail2` (*Upload thumbnails now*).
3. Auto-generate failed on this PDF → TPT served gray person placeholder (~5 KB).
4. Only **one** file was set on `#ItemDigitalPreview` (not 4 thumbnail slots) → public gallery had no ≥3 preview strip.
5. Listing went **Active $4.99** anyway — violated standing hard rule.

### Required fix for future `publish_tpt.py` patterns

- **Block Active** until:
  - `#ItemGenerateThumbnail2` is checked (value=`2`)
  - All 4 `#upload-thumb{1..4}` slots have `upload-finished` + non-empty upload-key
  - Submit must NOT proceed while radio1 is selected (auto-generate) unless CDN verify passes
- After submit: **verify public URL** — `original-{id}-1.jpg` ≥10KB AND ≥3 distinct `original-{id}-N.jpg` ≥10KB
- If verify fails: do not report success; re-edit or leave Inactive
- Working repair pattern: `avery-ops/reports/tpt-cover-audit-2026-09-28/fix_pumpkin_thumbs_v4.py` (force radio2, strip radio1/3 name attrs before Submit)
- Proven helpers also in `avery-factory/scripts/tpt_swap_live_covers.py` / `tpt_repair_ai_guides.py`

## Description hard rule (JD 2026-09-28 PM)

New rule (separate from covers): bilingual listing descriptions — **short Chinese first**, then concise English, real blank lines + bullets. Example flagged: #17532516 (too long, no paragraph spacing).

- Drafts path expected: `/workspace/avery-ops/reports/TPT-DESCRIPTION-DRAFTS-2026-09-28.md`
- **Status this run:** drafts file **not present** — cover/preview work completed first; parent to queue description paste starting with #17532516.

## Spot-check: Halloween + Mid-Autumn (all OK after fixes)

- **#17774630** cover=Y previews=4 — FIXED 2026-09-28: was placeholder; uploaded cover+4 previews; public verified
- **#17739468** cover=Y previews=4 — OK
- **#17733981** cover=Y previews=4 — OK
- **#17734062** cover=Y previews=4 — OK
- **#17734157** cover=Y previews=4 — OK
- **#17597740** cover=Y previews=4 — FIXED 2026-09-28: uploaded cover+4 previews (was 1)
- **#17597831** cover=Y previews=4 — FIXED 2026-09-28: uploaded cover+4 previews (was 1)
- **#17711456** cover=Y previews=4 — OK
- **#17711532** cover=Y previews=4 — OK
- **#17711359** cover=Y previews=4 — OK
- **#17712145** cover=Y previews=4 — OK
- **#17680418** cover=Y previews=4 — OK
- **#17610728** cover=Y previews=4 — OK
- **#17532516** cover=Y previews=4 — OK
- **#17682532** cover=Y previews=4 — OK

## Blockers

- None for covers/previews — **0 bare Active** remaining on storefront audit.
- Description uploads blocked on missing drafts file (parent).

