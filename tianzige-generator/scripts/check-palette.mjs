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
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`palette ok: ${tokens.size} tokens, ${statics.length} static files checked`);
