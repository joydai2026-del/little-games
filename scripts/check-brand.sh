#!/usr/bin/env bash
# Avery Studio brand check. Run from anywhere: bash scripts/check-brand.sh
# (each game: npm run check:brand). The law is docs/avery/brand/AVERY-BRAND-GUIDE.md.
# For every game folder that ships public/theme.css, public/momo.png or the
# retired public/momo.svg:
#   1. theme.css must be byte-identical to avery-brand/theme.css, and
#      momo.png, momo@2x.png, momo-icon.png, momo-icon@2x.png must match
#      avery-brand/ by sha256;
#   2. the retired ink-drop momo.svg must be gone (file AND every reference);
#   3. no retired colour (the old cream/mint/coral/ink kit) may appear in the
#      game's shipped surface and its docs (index.html, public/, src/, scripts/, tests/,
#      README.md, docs/; docs/avery/brand/, the guide itself, is never scanned);
#      check-palette.mjs is exempt because it lists them in order to reject them;
#   4. index.html must carry the title suffix, paper theme-color, the Momo PNG
#      favicon, the Baloo 2 + Quicksand + Noto Sans SC fonts link, /theme.css,
#      the L4 header lockup and the footer.
set -u
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kit="$root/avery-brand"
retired='#FFF7E8|#BFE8D8|#3FA88A|#FF7B6B|#2D3436|#636E72|#B2BEC3'
fail=0
checked=0
bad() { echo "BRAND FAIL  $1"; fail=1; gamefail=1; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

[ -f "$kit/momo.svg" ] && { echo "BRAND FAIL  avery-brand/momo.svg is retired: delete it"; fail=1; }

for dir in "$root"/*/; do
  game="$(basename "$dir")"
  [ "$game" = "avery-brand" ] && continue
  [ "$game" = "docs" ] && continue
  [ -f "$dir/public/theme.css" ] || [ -f "$dir/public/momo.png" ] || [ -f "$dir/public/momo.svg" ] || continue
  checked=$((checked + 1))
  gamefail=0
  if [ ! -f "$dir/public/theme.css" ]; then bad "$game: public/theme.css is missing (copy avery-brand/theme.css)"
  elif ! diff -q "$kit/theme.css" "$dir/public/theme.css" >/dev/null; then bad "$game: public/theme.css differs from avery-brand/theme.css"; fi
  for f in momo.png momo@2x.png momo-icon.png momo-icon@2x.png; do
    if [ ! -f "$dir/public/$f" ]; then bad "$game: public/$f is missing (copy avery-brand/$f)"
    elif [ "$(sha "$kit/$f")" != "$(sha "$dir/public/$f")" ]; then bad "$game: public/$f differs from avery-brand/$f (sha256)"; fi
  done
  [ -f "$dir/public/momo.svg" ] && bad "$game: public/momo.svg is the retired ink drop: delete it"
  surface=()
  for p in index.html public src scripts tests README.md docs; do [ -e "$dir/$p" ] && surface+=("$dir/$p"); done
  # docs/avery/brand/ is the locked guide itself (it may name retired things); never scanned.
  hits="$(grep -rIl --exclude-dir=node_modules 'momo\.svg' "${surface[@]}" 2>/dev/null | grep -v '/docs/avery/brand/')"
  [ -n "$hits" ] && bad "$game: still references momo.svg in: $(echo "$hits" | sed "s|$dir||" | tr '\n' ' ')"
  hits="$(grep -rIilE --exclude-dir=node_modules --exclude=check-palette.mjs "$retired" "${surface[@]}" 2>/dev/null | grep -v '/docs/avery/brand/')"
  [ -n "$hits" ] && bad "$game: retired colour ($retired) in: $(echo "$hits" | sed "s|$dir||" | tr '\n' ' ')"
  html="$dir/index.html"
  if [ ! -f "$html" ]; then bad "$game: index.html is missing"; continue; fi
  grep -qE '<title>[^<]+ · Avery Studio</title>' "$html" || bad "$game: <title> must end with ' · Avery Studio'"
  grep -qE '<meta name="theme-color" content="#FDF6EC"' "$html" || bad "$game: theme-color must be paper #FDF6EC"
  grep -qE '<link rel="icon" href="/momo-icon.png" type="image/png"' "$html" || bad "$game: favicon must be /momo-icon.png (type image/png)"
  grep -qE 'href="/theme.css"' "$html" || bad "$game: index.html must link /theme.css"
  grep -q 'fonts.googleapis.com/css2?family=Baloo+2' "$html" || bad "$game: Google Fonts link must start with Baloo 2"
  grep -q 'family=Quicksand' "$html" || bad "$game: Google Fonts link must include Quicksand"
  grep -q 'Noto+Sans+SC' "$html" || bad "$game: Google Fonts link must include Noto Sans SC"
  grep -q 'class="avery-header"' "$html" || bad "$game: .avery-header is missing from index.html"
  grep -q 'src="/momo-icon.png" srcset="/momo-icon.png 1x, /momo-icon@2x.png 2x"' "$html" || bad "$game: the header must show /momo-icon.png with the @2x srcset"
  grep -q 'class="avery-wordmark">Avery Studio<' "$html" || bad "$game: the header must carry the Avery Studio wordmark"
  grep -q 'class="avery-footer"' "$html" || bad "$game: .avery-footer is missing from index.html"
  [ "$gamefail" = 0 ] && echo "brand ok    $game"
done

if [ "$checked" = 0 ]; then echo "brand: no game ships the kit yet (nothing to check)"; fi
exit "$fail"
