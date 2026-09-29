---
name: Avery Teacher Printable QA
description: >-
  Use when Avery Teacher Review (or any Avery QA pass) reviews a Chinese K–5
  printable pack before TPT — advanced teacher checklist for pedagogy, layout,
  fun, listing readiness.
---

> Adopted by the Grok bots **Avery Teacher Review** and **Avery Student Review**.
>
> Factory skills live in `Avery-Studio-Product-Factory/agent-skills/`: `visual-first-chinese-k5-worksheet-factory`, `avery-quality-rebuild-workflow`, `chinese-teaching-materials`. Page-fill rules: [`PAGE-FILL-ACTIVITY-CONVENTION-2026-09-28.md`](PAGE-FILL-ACTIVITY-CONVENTION-2026-09-28.md).

# Avery Teacher Printable QA (advanced)

Use for every Avery Studio Chinese K–5 student printable before treating it as done / ready to re-upload.

Sources of truth (read when on box / in repo):
- `Avery-Studio-Product-Factory/agent-skills/visual-first-chinese-k5-worksheet-factory.md`
- `Avery-Studio-Product-Factory/agent-skills/avery-quality-rebuild-workflow.md`
- `Avery-Studio-Product-Factory/agent-skills/chinese-teaching-materials.md`
- `little-games/docs/avery/ops/PAGE-FILL-ACTIVITY-CONVENTION-2026-09-28.md`
- Cover+preview + bilingual description ops docs under `little-games/docs/avery/ops/`
- Product `JD-QA-CHECKLIST.md` / `worksheet-qa-gates.md` patterns

## Hard fail (any one = Fail)

1. Large empty bottom or hollow activity box (colored frame with blank interior counting as "fill")
2. Reused identical art for different vocab words
3. Sparse color-by-code (≤4 trivial regions) when task claims to be a coloring game — require mystery/full-page reveal or 6–10+ meaningful codes
4. Student page English walls (titles/directions/labels) unless JD explicitly asked bilingual student pages
5. Emoji / 乱码 / tofu glyphs; Heiti/sans for practice characters (must be 楷体 / LXGW WenKai)
6. Missing cover OR <3 previews on Active TPT listing
7. Wrong character pedagogy (invented stroke order, mixed 简繁 on one page)
8. Activity is only densified busywork — no movement, game, mystery, craft, or social lever when the SKU promises "activities"

## Score every pack (Pass / Needs work / Fail)

| Axis | Ask |
|---|---|
| Level-appropriate | K–5 immersion / heritage load OK? scaffolds (田字格, 组词, picture) match claimed band? |
| Educational | Clear language goal? meaningful practice vs decoration? answer key if needed? |
| Engaged / fun | Would a real Oct center keep kids busy? bingo, write-the-room, mystery color, I-spy, roll-a-monster, board/escape-lite preferred over match-and-trace-only |
| Layout QA | ≥85% vertical fill; dead space ≤1/3; art matches word; unique pics; no fat empty 说一说 bands |
| Teacher usable | Prep time clear; cut lines OK; differentiation; speak/write frames that are filled with real prompts not blank purple |

## Page-type gates (copy visual-first skill)

- **K–2:** 60–80% image/game/response area
- **3–5:** 45–70%
- **Color-by-code:** coherent mystery image; Chinese color words + swatches; B&W-print safe
- **Writing:** model → 描红 → empty 田字格; bottom = 找一找 / 看图写字 / 看图写句子 — never empty
- **Flashcards:** unique full art per word; Games section = real bingo/memory rules that fill the box
- **Craft:** intentional cut-white OK; non-cut activity pages still follow density

## Output format

```
Verdict: Pass | Needs work | Fail
Level: …
Educational: …
Fun/engagement: …
Layout: …
Teacher usability: …
Must-fix (bullets with page refs):
Nice-to-have:
Ship blockers:
```

Never invent pages you were not shown. Ask for missing PNGs/PDFs. Do not publish or edit files — review only.
