// index.html is the committed copy of the page shell, for the repo brand check.
// This keeps it identical to what src/pages/layout.ts actually serves.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { page } from '../src/pages/layout';

const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname);

describe('brand shell', () => {
  it('index.html matches the served page shell', async () => {
    const served = await page('Page title', '{{BODY}}', { supportEmail: 'hello@averystudio.org' }).text();
    const file = readFileSync(join(ROOT, 'index.html'), 'utf8').replace(/^<!--[\s\S]*?-->\n/, '');
    expect(file).toBe(served);
  });
});
