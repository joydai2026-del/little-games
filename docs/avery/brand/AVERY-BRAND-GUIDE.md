# Avery Studio Brand Guide

**Version:** 2026-09-24 (L4 lockup lock)  
**Brand:** Avery Studio  
**Source of truth:** live site color tokens in `joydong.org/index-averystudio.html`; mascot = Momo brush files in `brand/avatars/momo/` (JD locked 2026-09-24).

## 1. Brand essence

Avery Studio makes printable Chinese K–5 classroom materials with a warm storybook feel: practical resources that are easy for teachers to use and inviting for students, guided by **墨墨 (Mòmo)** — a friendly mint puppy with a calligraphy brush.

## 2. Logo / mascot system

### Primary mark

**Canonical mascot (locked 2026-09-24):** **墨墨 (Mòmo)** — little mint dog with a traditional calligraphy brush behind one ear.

- **Character name:** 墨墨 / Momo (墨 = ink → Chinese writing & strokes). Not “Avery.”
- **Brand name:** Avery Studio stays the studio wordmark.
- **Look:** mint fill (`--mascot` `#BEE1D4`), deeper mint outline (`--mascot-2` `#9CCEBC`), soft pink inner ears and cheeks (`--pink` `#F4869C`), cocoa eyes and smile (`--ink` `#42291D`), floppy ears, brush tucked behind one ear.
- **Style:** flat vector storybook, simple bold shapes that stay clear at TPT icon size. No emoji substitute.
- **Canonical files:** `brand/avatars/momo/momo-brush-official.png` (hero) and `momo-brush-tpt-icon.png` (tight store icon). Source board look: D1 brush.

The live site header SVG may still show the older mint cat until the site is updated to Momo. New productions, TPT avatar, games UI, and covers should use **Momo + brush**.

### Lockup (canonical — JD locked L4, 2026-09-24)

Primary logo = **Momo + Avery Studio wordmark + tagline**, not Momo alone.

- **Layout:** horizontal (site, banner endcaps, docs) or stacked square (TPT profile / favicon circle).
- **Wordmark:** `Avery Studio` — Baloo 2 feel (rounded, friendly, storybook), cocoa `#42291D`.
- **Accent:** thin coral underline `#F4869C` under the wordmark.
- **Tagline:** `printable classroom materials` — Quicksand-like, smaller, soft cocoa.
- **Background:** cream paper `#FDF6EC`.
- **Files:**
  - `brand/avatars/momo/lockups/L4-official-horizontal.png`
  - `brand/avatars/momo/lockups/L4-official-square-tpt.png`
- Optional character line in games/copy: “with 墨墨 (Momo)” — never rename the studio to Momo.
- Face-only Momo is for in-game stickers / corner marks only — **not** the store logo.

### Avatar use cases

Momo may be used for:

- TPT store profile
- Site favicon and header (after site swap)
- PDF cover corner
- Games page and in-game coach
- Social profiles and posts

## 3. Color tokens

Use the live site tokens exactly. Hex values are uppercase for documentation consistency.

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#FDF6EC` | Main paper background |
| `--paper-deep` | `#F6E9D8` | Deeper paper sections and bands |
| `--card` | `#FFFCF6` | Cards and raised surfaces |
| `--ink` | `#42291D` | Primary text; deep cocoa, never pure black |
| `--ink-soft` | `#6B5142` | Secondary text |
| `--pink` | `#F4869C` | Coral/pink accents and CTAs |
| `--pink-deep` | `#C85B73` | Darker CTA, emphasis, or hover state |
| `--pink-soft` | `#FBDCE3` | Soft pink fills |
| `--sage` | `#A9D3B8` | Calm UI and sage accents |
| `--sage-soft` | `#DEEFE4` | Soft sage fills |
| `--butter` | `#F4D894` | Warm accent, card, or tag |
| `--butter-soft` | `#FBEECB` | Soft butter fills |
| `--sky` | `#A5C9E8` | Cool accent, card, or tag |
| `--sky-soft` | `#DDEAF7` | Soft sky fills |
| `--mascot` | `#BEE1D4` | Primary mint Momo fill |
| `--mascot-2` | `#9CCEBC` | Momo outline and secondary mint |

### Usage guidance

- Use cream paper (`--paper`) for page backgrounds and the warm storybook ground.
- Use pink/coral for CTAs and lively accents; keep contrast and readability strong.
- Use sage/mint for Momo and calm UI states.
- Use cocoa ink for body text; never use pure black.
- Use butter and sky for cards, tags, and gentle category differentiation.
- Keep the palette soft and printable-looking; do not introduce arbitrary neon colors.

## 4. Typography

- **Headings and product titles:** Baloo 2.
- **Body copy, navigation, buttons, labels, and UI:** Quicksand.
- **Chinese on student-facing pages:** large, clear, and allowed to fill the page. This is the **Avery QA rule**: Chinese should never be treated as tiny supporting text when students need to read or write it.

## 5. Voice

Write warm teacher-to-teacher copy: concrete, encouraging, and useful. Lead with Chinese-first student materials and explain what a teacher can print, teach, or use. Avoid hype, slang, inflated claims, and generic marketing language.

## 6. Product art rules

- Use Grok Image quality standards for craft art and product covers: clean shapes, readable composition, classroom-appropriate warmth, and print-ready clarity.
- No emoji,乱码, accidental gibberish, or fake text in product art.
- Every paid product needs a clear cover plus **at least three previews**.
- Do not leave large empty bottoms in PDFs; use the page area intentionally.
- Banner text must never overlap product thumbnails.
- Keep Chinese text large and legible in covers, previews, and student pages; verify characters before publishing.

## 7. Seasonal system

Swap the promotional banner monthly or by teaching season (for example, Halloween, Mid-Autumn Festival, back-to-school, or winter). Seasonal illustration, keywords, pill, and product thumbnails may change. The **avatar and wordmark stay fixed** so the brand remains recognizable across every seasonal version.

## 8. Channel split

- **TPT:** PDF printables and printable product discovery; covers, previews, and listings should make the print/use case obvious.
- **averystudio.org:** Brand home, catalog context, Games, and future subscription or sub-brand experiences.

Use each channel for its job: TPT converts teachers looking for downloadable classroom materials; the site builds the broader Avery Studio relationship and supports Games and future products.

## 9. File locations

- Brand assets: `avery-tpt-storefront-audit/brand/`
- Canonical Momo: `avery-ops/brand/avatars/momo/`
- Archive drafts: `avery-tpt-storefront-audit/brand/avatars/` (+ `v2/`, dog board)
- This guide: `avery-ops/brand/AVERY-BRAND-GUIDE.md`

## 10. Do / Don't

### Do

- Do keep Momo (mint dog + brush), rounded type, cream paper, and cocoa ink recognizable.
- Do write for real K–5 teachers and Chinese learners.
- Do make Chinese student materials large, clear, and useful.
- Do show the product clearly with a cover and three or more previews when paid.
- Do let seasonal art change while the core identity stays stable.

### Don't

- Don’t use pure black, neon colors, emoji, or乱码 in brand/product art.
- Don’t invent a second mascot; Momo + brush is locked. Site header cat is legacy until swapped.
- Don’t use hype slang or vague promises instead of concrete teacher benefits.
- Don’t hide product thumbnails under banner text or leave large unused PDF areas.
- Don’t let a seasonal banner, sub-brand, or Games concept replace the Avery Studio core mark and wordmark.

## 11. Avery Games (second product line)

Business Owner owns Games alongside printables. **TPT stays PDF.** Games live on averystudio.org (and future Avery domains).

### Product wedge
- **Two working games (JD 2026-09-24):** both are classroom Avery Games, not “one core + one side.”
  1. **Vocabulary Game Generator** — teacher pastes a list → Memory Match / Race / Climb / Dash. Strong L2 wedge.
  2. **Caption Wars (Chinese vocab mode)** — teacher gives a vocab list or prompt; pictures appear for that set; students write captions and vote **in Chinese**. Same engine can stay party-mode later; classroom mode is first-class.
- Games are already **functional**; next work is **UI/UX rebrand** to this guide (cream paper, coral CTAs, mint mascot, Baloo/Quicksand), not a rewrite of game logic.

### Character system (Muse-inspired)
- Soft **Momo** personas with **outfits/roles** (teacher Momo, student friends, festival costumes) for engagement in language play.
- Outfits are language-learning personas, not random party skins.
- Characters share Momo’s mint-dog DNA + brush cue; seasonal clothes change, core face stays recognizable.

### Language extensibility
- Chinese K–5 first.
- Keep **word lists / language packs** separate from **game engines** so Spanish (and later languages) ship as content packs — not forked apps.
- UI copy and TTS voices should be pack-driven where possible.

### Rebrand sequence
1. This brand guide locks visual tokens.
2. Re-skin vocab game UI to Avery.
3. Add character outfits.
4. Hub page at `/games` with Avery shell; Workers stay under the hood (custom domains later).
5. FREE TPT printable funnel → Games page.
6. Subscription only after real teacher plays.

## 12. Canonical logo + mascot (locked)

JD locked **2026-09-24:**

1. **Character:** 墨墨 (Mòmo) — mint dog + calligraphy brush.
2. **Logo lockup L4:** Momo + **Avery Studio** wordmark + coral underline + tagline `printable classroom materials`.

| File | Role |
|---|---|
| `avery-ops/brand/avatars/momo/lockups/L4-official-horizontal.png` | Primary logo (site, docs, banners) |
| `avery-ops/brand/avatars/momo/lockups/L4-official-square-tpt.png` | TPT store profile / square crop |
| `avery-ops/brand/avatars/momo/momo-brush-official.png` | Face-only hero (games stickers) |
| `avery-ops/brand/avatars/momo/momo-brush-tpt-icon.png` | Face-only icon (archive after L4 TPT swap) |

Earlier cat drafts A–E, dog board D0–D5, and lockups L1–L3 are archive only.
