#!/usr/bin/env node
// Regenerates src/shared/fixture-photo.ts from tests/fixtures/photo.jpg.
//
// Why a generated TypeScript module instead of reading the file at runtime:
// the AI smoke endpoint (POST /api/ai-smoke) runs inside the Worker, which has
// no filesystem, and the static-assets binding only serves what the client's
// vite build emits (a folder this side of the project does not own). Embedding
// the bytes as base64 makes the exact same photo available to the Worker and to
// the vitest suite, with no coupling to either build.
//
// Run: node scripts/make-fixture.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'tests/fixtures/photo.jpg');
const target = join(root, 'src/shared/fixture-photo.ts');

const bytes = readFileSync(source);
const base64 = bytes.toString('base64');
const sha256 = createHash('sha256').update(bytes).digest('hex');

const lines = [];
for (let i = 0; i < base64.length; i += 100) lines.push(`  '${base64.slice(i, i + 100)}',`);

writeFileSync(
  target,
  `// GENERATED FILE - do not edit by hand. Run: node scripts/make-fixture.mjs
//
// The bundled test photo: a real 800x600 loremflickr goat photo fetched on
// 2026-09-07 (tests/fixtures/photo.jpg). It is real image bytes, not a mock,
// so the AI smoke test exercises the vision model on something it can describe.
//
// bytes:  ${bytes.length}
// sha256: ${sha256}

export const FIXTURE_PHOTO_SHA256 = '${sha256}';
export const FIXTURE_PHOTO_BYTES = ${bytes.length};
export const FIXTURE_PHOTO_CONTENT_TYPE = 'image/jpeg';

const BASE64 = [
${lines.join('\n')}
].join('');

/** The fixture photo as raw bytes. Works in the Worker and in vitest (atob is global in both). */
export function fixturePhoto(): Uint8Array {
  const binary = atob(BASE64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
`,
  'utf8'
);

console.log(`wrote ${target} (${bytes.length} bytes, sha256 ${sha256})`);
