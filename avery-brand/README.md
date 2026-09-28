# Avery Studio brand kit

One look for every Avery Studio tool (田字格 Writing Sheets, Trace Race, the vocab games).
**The law is [`docs/avery/brand/AVERY-BRAND-GUIDE.md`](../docs/avery/brand/AVERY-BRAND-GUIDE.md)** (locked 2026-09-24).
This folder turns it into files a game can copy. Games copy the files; they never edit their copies.

## The mascot: 墨墨 Momo, the mint puppy with a brush

Momo is a mint puppy with a calligraphy brush behind one ear. Every Momo image here is cut
from the locked PNGs in `docs/avery/brand/avatars/momo/`; no new art is ever drawn.
The old ink-drop `momo.svg` is retired: `check-brand.sh` fails if any game still ships or links it.

| File | From (locked) | Size | Use |
|---|---|---|---|
| `momo.png` | `momo-brush-official.png` | 256 px, transparent | In-game Momo: speech line, cheers, hints, winners |
| `momo@2x.png` | `momo-brush-official.png` | 512 px, transparent | The same, for retina screens (`srcset` 2x) |
| `momo-icon.png` | `momo-brush-tpt-icon.png` | 64 px, transparent | Header lockup (shown at 44 px) and favicon |
| `momo-icon@2x.png` | `momo-brush-tpt-icon.png` | 128 px, transparent | The same, for retina screens (`srcset` 2x) |
| `theme.css` | guide sections 3 and 4 | | Tokens, fonts, header, footer, buttons |
| `../scripts/make-momo-assets.py` | | | Rebuilds all four PNGs byte-for-byte from the locked files (needs Pillow) |
| `../scripts/check-brand.sh` | | | The check (see below) |

**Face-only Momo is for in-game stickers only.** The store logo is always the L4 lockup
(Momo + wordmark + coral underline), never Momo alone: `docs/avery/brand/avatars/momo/lockups/L4-official-horizontal.png`
and `L4-official-square-tpt.png`.

## What every Avery tool must carry

1. **Five kit files, unedited**: copy `theme.css`, `momo.png`, `momo@2x.png`, `momo-icon.png` and `momo-icon@2x.png` into the game's `public/`.
   Game-only colours and rules go in a separate file loaded after `theme.css`.
2. **Page title**: `<title>Tool name · Avery Studio</title>`.
3. **Browser bar colour**: `<meta name="theme-color" content="#FDF6EC">` (paper).
4. **Favicon**: `<link rel="icon" href="/momo-icon.png" type="image/png">`.
5. **Fonts**: Baloo 2 (headings and product titles), Quicksand (all UI), Noto Sans SC (Chinese UI).
   Both stacks fall back to local CJK faces (PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC):
   ```html
   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Quicksand:wght@500;600;700&family=Noto+Sans+SC:wght@400;700&display=swap">
   <link rel="stylesheet" href="/theme.css">
   ```
   Chinese characters the child writes or traces keep their own Kaiti stack; Noto Sans SC is for labels and buttons.
6. **Header on every screen** (never on printed pages): the L4 lockup in HTML, 64 px tall.
   Momo icon 44 px, "Avery Studio" in Baloo 2 700 cocoa with a thin coral underline, "with 墨墨 Momo" in Quicksand soft cocoa:
   ```html
   <header class="avery-header">
     <a href="/" aria-label="Avery Studio home">
       <img src="/momo-icon.png" srcset="/momo-icon.png 1x, /momo-icon@2x.png 2x" alt="" width="44" height="44">
       <span class="avery-lockup">
         <span class="avery-wordmark">Avery Studio</span>
         <span class="avery-tagline">with 墨墨 Momo</span>
       </span>
     </a>
   </header>
   ```
   Every in-game Momo `<img>` carries the 2x source too: `srcset="/momo.png 1x, /momo@2x.png 2x"`
   (retina phones and iPads would otherwise show a soft puppy).
   **Header link rule**: the header is disabled on screens where leaving loses progress (a kid mid-race):
   render it as plain text there (drop the `href`), never a live link.
7. **Footer on every screen**, the brand line first, the tool's own credits under it:
   ```html
   <footer class="avery-footer">
     <p class="avery-line"><b>Avery Studio</b> · 墨墨 Momo · averystudio.org</p>
     <p class="avery-credits">(licences and credits for this tool)</p>
   </footer>
   ```
   Footer links are 64 px tap targets. Header and footer hide when printing; a printed worksheet keeps its own small footer.
8. **Buttons**: `.btn-primary` (pink fill, cocoa text) and `.btn-secondary` (card fill, mint border, cocoa text). Both at least 64 px tall, labels 19 px bold.

## Contrast pairs (WCAG 2.x, computed from the hex values)

Body text needs 4.5:1. Large text (24 px, or 18.66 px bold) needs 3:1.

| Text on fill | Ratio | Verdict | Where it is used |
|---|---|---|---|
| ink `#42291D` on pink `#F4869C` | 5.58:1 | passes at any size | `.btn-primary` |
| card `#FFFCF6` on pink-deep `#C85B73` | 3.94:1 | large text only | `.btn-primary:hover` (19 px bold) |
| white on pink-deep `#C85B73` | 4.04:1 | large text only | not used for body text |
| white on pink `#F4869C` | 2.40:1 | **fails** | never |
| ink on paper `#FDF6EC` | 12.49:1 | passes | body text |
| ink-soft `#6B5142` on paper | 6.79:1 | passes | secondary text, footer, tagline |
| ink on card `#FFFCF6` | 13.09:1 | passes | cards, `.btn-secondary` |
| ink on mascot `#BEE1D4` | 9.52:1 | passes | mint chips, selected options |
| ink on pink-soft `#FBDCE3` | 10.50:1 | passes | error and warning chips |
| pink-deep on paper | 3.76:1 | large text only | big numbers (countdown) |
| pink `#F4869C` on paper | 2.24:1 | **fails as text** | borders and accents only |
| mascot-2 `#9CCEBC` on paper | 1.64:1 | **fails as text** | fills and outlines only |

## Tokens (guide section 3)

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#FDF6EC` | page background, theme-color |
| `--paper-deep` | `#F6E9D8` | deeper bands, dividers |
| `--card` | `#FFFCF6` | cards, raised surfaces |
| `--ink` | `#42291D` | text (deep cocoa, never black) |
| `--ink-soft` | `#6B5142` | secondary text |
| `--pink` | `#F4869C` | CTAs, accents |
| `--pink-deep` | `#C85B73` | CTA hover, large emphasis |
| `--pink-soft` | `#FBDCE3` | soft pink fills |
| `--sage` / `--sage-soft` | `#A9D3B8` / `#DEEFE4` | calm UI |
| `--butter` / `--butter-soft` | `#F4D894` / `#FBEECB` | warm cards, tags |
| `--sky` / `--sky-soft` | `#A5C9E8` / `#DDEAF7` | cool cards, tags |
| `--mascot` / `--mascot-2` | `#BEE1D4` / `#9CCEBC` | Momo mint and its outline |
| `--font-head` | Baloo 2, Noto Sans SC, CJK | headings, titles, wordmark |
| `--font-ui` | Quicksand, Noto Sans SC, CJK | all UI text |
| `--tap` | 64px | smallest tap target |

**Old names still resolve** (aliases, so older game CSS keeps working): `--cream` = paper, `--mint` = mascot,
`--mint-deep` = mascot-2, `--coral` = pink, `--muted` = ink-soft, `--line` = paper-deep.
The old values (`#FFF7E8`, `#BFE8D8`, `#3FA88A`, `#FF7B6B`, `#2D3436`, `#636E72`, `#B2BEC3`) are retired;
the check fails if any of them appears in a game.

## Running the check

From the repo root: `bash scripts/check-brand.sh`. From a game folder: `npm run check:brand`.
It looks at every game folder that ships `public/theme.css`, `public/momo.png` or the retired `public/momo.svg`, and fails when:
`theme.css` differs from this folder; any of the four Momo PNGs differs by sha256; `momo.svg` still exists or is still
referenced; a retired colour appears in `index.html`, `public/`, `src/`, `scripts/`, `tests/` or `README.md`; or the page
lacks the title suffix, paper theme-color, PNG favicon, fonts link, `/theme.css`, the header lockup, or the footer.

## Changing the brand

Change the guide first. Then edit the file here and copy it into every game's `public/` in the same change. The check keeps them honest.
