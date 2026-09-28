#!/usr/bin/env bash
# Avery Studio brand check. Run from anywhere: bash scripts/check-brand.sh
# (each game: npm run check:brand). For every game folder that ships
# public/momo.svg or public/theme.css:
#   1. both files must be byte-identical to avery-brand/ (the canonical kit);
#   2. index.html must carry the title suffix, cream theme-color, Momo favicon,
#      the fonts link, and the shared header + footer.
set -u
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kit="$root/avery-brand"
fail=0
checked=0
bad() { echo "BRAND FAIL  $1"; fail=1; gamefail=1; }

for dir in "$root"/*/; do
  game="$(basename "$dir")"
  [ "$game" = "avery-brand" ] && continue
  [ -f "$dir/public/momo.svg" ] || [ -f "$dir/public/theme.css" ] || continue
  checked=$((checked + 1))
  gamefail=0
  for f in momo.svg theme.css; do
    if [ ! -f "$dir/public/$f" ]; then bad "$game: public/$f is missing (copy avery-brand/$f)"
    elif ! diff -q "$kit/$f" "$dir/public/$f" >/dev/null; then bad "$game: public/$f differs from avery-brand/$f"; fi
  done
  html="$dir/index.html"
  if [ ! -f "$html" ]; then bad "$game: index.html is missing"; continue; fi
  grep -qE '<title>[^<]+ · Avery Studio</title>' "$html" || bad "$game: <title> must end with ' · Avery Studio'"
  grep -qE '<meta name="theme-color" content="#FFF7E8"' "$html" || bad "$game: theme-color must be cream #FFF7E8"
  grep -qE '<link rel="icon" href="/momo.svg"' "$html" || bad "$game: favicon must be /momo.svg"
  grep -qE 'href="/theme.css"' "$html" || bad "$game: index.html must link /theme.css"
  grep -q 'fonts.googleapis.com/css2?family=DM+Sans' "$html" || bad "$game: Google Fonts link for DM Sans + Noto Sans SC is missing"
  grep -q 'Noto+Sans+SC' "$html" || bad "$game: Google Fonts link must include Noto Sans SC"
  grep -q 'class="avery-header"' "$html" || bad "$game: .avery-header is missing from index.html"
  grep -q 'class="avery-footer"' "$html" || bad "$game: .avery-footer is missing from index.html"
  [ "$gamefail" = 0 ] && echo "brand ok    $game"
done

if [ "$checked" = 0 ]; then echo "brand: no game ships public/momo.svg or public/theme.css yet (nothing to check)"; fi
exit "$fail"
