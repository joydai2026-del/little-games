// Builds src/worker/stroke-counts.json ({ char: strokeCount }) from an unpacked
// hanzi-writer-data@2.0.1 tarball, refusing any file whose sha256 differs from
// the committed manifest (src/worker/strokes-manifest.json). The room uses the
// counts to know when a character is finished without calling the CDN.
//
//   node scripts/make-stroke-counts.mjs <path/to/unpacked/package>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/make-stroke-counts.mjs <unpacked hanzi-writer-data package dir>');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(new URL('../src/worker/strokes-manifest.json', import.meta.url), 'utf8'));
const counts = {};
for (const [char, hash] of Object.entries(manifest.files)) {
  const body = readFileSync(join(dir, `${char}.json`));
  const actual = createHash('sha256').update(body).digest('hex');
  if (actual !== hash) throw new Error(`hash mismatch for ${char}`);
  counts[char] = JSON.parse(body.toString('utf8')).strokes.length;
}
writeFileSync(new URL('../src/worker/stroke-counts.json', import.meta.url), JSON.stringify(counts));
console.log(`wrote ${Object.keys(counts).length} stroke counts`);
