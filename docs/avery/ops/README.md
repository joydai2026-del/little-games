# Avery Studio — TPT ops notes

Working docs for Teachers Pay Teachers seller ops (covers, previews, bilingual descriptions).

## 2026-09-28

| Doc | Purpose |
|-----|---------|
| [TPT-COVER-PREVIEW-AUDIT-2026-09-28.md](./TPT-COVER-PREVIEW-AUDIT-2026-09-28.md) | Cover + preview audit — **74/74 Active OK** |
| [TPT-DESCRIPTION-REWRITE-2026-09-28.md](./TPT-DESCRIPTION-REWRITE-2026-09-28.md) | Bilingual description rewrite status — **74/74 live** |
| [TPT-BILINGUAL-DESCRIPTION-TEMPLATE.md](./TPT-BILINGUAL-DESCRIPTION-TEMPLATE.md) | Reusable Chinese-first description template |

## Hard publish rule

**`publish_tpt.py` must not set a product Active without cover + ≥3 preview thumbnails.**

Description paste: Chinese block first → English → spaced bullets / HTML (`<p>` + `<ul><li>`). True Bundle products use `/itemsBundle/editNext/{id}`.
