// Palette gate. Colours are defined in exactly two places:
//   public/theme.css  the Avery Studio brand kit (identical to avery-brand/, see check:brand)
//   public/sheet.css  the game-only tokens, in its :root block
// No colour literal anywhere in src/ (CSS or TS) or in the rest of sheet.css.
// index.html and public/*.svg cannot read CSS variables (the <meta> tag and an
// <img> SVG are outside the page's CSS), so they may REPEAT a colour, but only
// one that is a defined token.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const theme = readFileSync(join(root, 'public/theme.css'), 'utf8');
const sheet = readFileSync(join(root, 'public/sheet.css'), 'utf8');
const sheetRoot = sheet.match(/:root\s*\{[^}]*\}/)?.[0] ?? '';
const tokens = new Set([...(theme.match(HEX) ?? []), ...(sheetRoot.match(HEX) ?? [])].map((c) => c.toUpperCase()));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const problems = [];
for (const file of walk(join(root, 'src')).filter((f) => /\.(css|ts)$/.test(f))) {
  for (const hit of readFileSync(file, 'utf8').match(HEX) ?? []) problems.push(`${file}: literal ${hit} (use a token)`);
}
for (const hit of sheet.replace(sheetRoot, '').match(HEX) ?? []) problems.push(`public/sheet.css: literal ${hit} outside :root (use a token)`);
const statics = [join(root, 'index.html'), ...walk(join(root, 'public')).filter((f) => f.endsWith('.svg'))];
for (const file of statics) {
  for (const hit of readFileSync(file, 'utf8').match(HEX) ?? []) {
    if (!tokens.has(hit.toUpperCase())) problems.push(`${file}: ${hit} is not a token`);
  }
}
// The locked Avery palette (docs/avery/brand/AVERY-BRAND-GUIDE.md section 3) must all be
// tokens, and the retired kit colours must be gone from every token source.
const LOCKED = ['#FDF6EC', '#F6E9D8', '#FFFCF6', '#42291D', '#6B5142', '#F4869C', '#C85B73', '#FBDCE3',
  '#A9D3B8', '#DEEFE4', '#F4D894', '#FBEECB', '#A5C9E8', '#DDEAF7', '#BEE1D4', '#9CCEBC'];
const RETIRED = ['#FFF7E8', '#BFE8D8', '#3FA88A', '#FF7B6B', '#2D3436', '#636E72', '#B2BEC3'];
for (const c of LOCKED) if (!tokens.has(c)) problems.push(`theme.css: locked token ${c} is missing`);
for (const c of RETIRED) if (tokens.has(c)) problems.push(`retired colour ${c} is still a token`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`palette ok: ${tokens.size} tokens, ${statics.length} static files checked`);
