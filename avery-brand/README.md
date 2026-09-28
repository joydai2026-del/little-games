# Avery Studio brand kit

One look for every Avery Studio tool (田字格 Writing Sheets, Trace Race, the vocab games).
This folder is the single source. Games copy the two asset files; they never edit their copies.

## What is here

| File | What it is |
|---|---|
| `momo.svg` | 墨墨 Momo, the ink drop. Placeholder art until the real mascot exists. Fills use only palette hexes (ink, cream, coral, mint). |
| `theme.css` | The colour tokens, the font stack, the shared header, footer, and buttons. |
| `../scripts/check-brand.sh` | The check. Fails if a game's copy drifts or its page is missing a brand piece. |

## What every Avery tool must carry

1. **Both files, unedited**: copy `momo.svg` and `theme.css` into the game's `public/`. Game-only colours and rules go in a separate file (for example `public/game.css` or the game's own stylesheet) loaded after `theme.css`.
2. **Page title**: `<title>Tool name · Avery Studio</title>`.
3. **Browser bar colour**: `<meta name="theme-color" content="#FFF7E8">` (cream).
4. **Favicon**: `<link rel="icon" href="/momo.svg" type="image/svg+xml">`.
5. **Fonts**: DM Sans (the Avery design system's UI font) and Noto Sans SC (Chinese UI text):
   ```html
   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Noto+Sans+SC:wght@400;700&display=swap">
   <link rel="stylesheet" href="/theme.css">
   ```
   Chinese characters the child writes or traces keep their own Kaiti stack; Noto Sans SC is for labels and buttons.
6. **Header on every screen** (not on printed pages). Momo 40 px, the wordmark, and "· 墨墨 Momo", all one link home:
   ```html
   <header class="avery-header">
     <a href="/" aria-label="Avery Studio home">
       <img src="/momo.svg" alt="" width="40" height="40">
       <span class="avery-wordmark">Avery Studio</span>
       <span class="avery-sub">· 墨墨 Momo</span>
     </a>
   </header>
   ```
7. **Footer on every screen**, the brand line first, the tool's own credits under it:
   ```html
   <footer class="avery-footer">
     <p class="avery-line">Avery Studio · 墨墨 Momo · averystudio.org</p>
     <p class="avery-credits">(licences and credits for this tool)</p>
   </footer>
   ```
   The header and footer hide themselves when printing. A printed worksheet keeps its own small print footer.
8. **Buttons**: `.btn-primary` (mint-deep fill, INK text) and `.btn-secondary` (cream, mint border). Both are at least 64 px tall. White text on mint-deep fails contrast (2.9:1); ink on mint-deep is 4.3:1, which passes only as large text, so labels stay 19 px or bigger and bold.

## Tokens

| Token | Hex | Use |
|---|---|---|
| `--cream` | `#FFF7E8` | page background, theme-color |
| `--mint` | `#BFE8D8` | light fills, borders |
| `--mint-deep` | `#3FA88A` | primary buttons |
| `--coral` | `#FF7B6B` | accent, focus ring |
| `--ink` | `#2D3436` | text |
| `--muted` | `#636E72` | secondary text (4.9:1 on cream) |
| `--line` | `#B2BEC3` | dividers |
| `--card` | `#FFFFFF` | cards, paper |
| `--font-ui` | DM Sans, Noto Sans SC, system-ui | all UI text |
| `--tap` | 64px | smallest tap target |

## Running the check

From the repo root: `bash scripts/check-brand.sh`. From a game folder: `npm run check:brand`.
It looks at every game folder that has `public/momo.svg` or `public/theme.css` and fails when:
a copy differs from this folder, the title lacks " · Avery Studio", the theme-color is not cream,
the favicon is not Momo, the fonts link or `/theme.css` link is missing, or the header or footer is missing.

## Changing the brand

Edit the file here, then copy it into every game's `public/` in the same change. The check keeps them honest.
