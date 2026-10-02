# Avery TPT — Reusable bilingual description template

**Source date:** 2026-09-28 (ET)  
**Hard rule:** Chinese block first → English block → spaced bullets · concise · no emoji/乱码 · Avery warm/clear.

Also: **`publish_tpt.py` must not set a product Active without cover + ≥3 preview thumbnails.**

---

## Reusable template (future publishes)

```
[中文短段：这是什么 / 给谁用 / 核心卖点一句话]

[English short intro: what it is + who + one promise]

• Bullet 1 (format / pages / language)
• Bullet 2 (what’s inside)
• Bullet 3 (grade / use)
• Bullet 4 (optional pair CTA)
• …max ~4–8 total

PAIR WITH / 搭配：

• Related FREE / paid / bundle with product #id

Avery Studio · averystudio.org
```

**TPT paste tips**

- Prefer the **HTML** block if the editor supports source/HTML (uses `<p>` + `<ul><li>`).
- Otherwise paste **Plaintext** and ensure blank lines survive (Enter twice between paragraphs; one Enter between bullets is OK if TPT collapses — then switch to HTML).
- Do **not** change price or unpublish unless save requires it.
- Keep cover + ≥3 previews when touching edit pages (coordinate with cover agent).

**HTML skeleton**

```html
<p>中文短段…</p>
<p>English short intro…</p>
<ul>
<li>…</li>
</ul>
<p><strong>PAIR WITH / 搭配：</strong></p>
<ul>
<li>…</li>
</ul>
<p>Avery Studio · averystudio.org</p>
```

---

## publish_tpt.py gate (ops rule)

Before flipping status to **Active**:

1. Cover image present and correct (OG/card)
2. **≥3** product preview thumbnails selected/uploaded
3. Description pasted with Chinese-first bilingual structure (this template)

Do not Active-publish incomplete listings.
