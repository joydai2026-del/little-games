// Nobody bypasses the layers later: env.DB only under src/db/, and nothing
// teacher-facing imports the admin module.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = decodeURIComponent(new URL('../src', import.meta.url).pathname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}
const all = files(SRC);
const rel = (p: string) => p.slice(SRC.length + 1);

describe('structure', () => {
  it('env.DB (or a DB binding read) appears only under src/db/', () => {
    const offenders = all.filter((f) => !rel(f).startsWith('db/') && /\benv\.DB\b|\[['"]DB['"]\]|\bDB\s*:/.test(readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')));
    expect(offenders.map(rel).filter((f) => f !== 'env.ts')).toEqual([]);
  });

  it('only src/admin/ imports the admin module or the admin SQL', () => {
    const offenders = all.filter((f) => {
      if (rel(f).startsWith('admin/') || rel(f) === 'index.ts') return false;
      const src = readFileSync(f, 'utf8');
      return /from ['"][./]*(\.\.\/)?admin\//.test(src) || /admin-ops/.test(src);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('src/index.ts touches admin only through the /admin/* route', () => {
    const src = readFileSync(join(SRC, 'index.ts'), 'utf8');
    const lines = src.split('\n').filter((l) => /adminRoute/.test(l));
    expect(lines.some((l) => /startsWith\('\/admin\/'\)/.test(l))).toBe(true);
    expect(lines.length).toBe(2); // the import and the one call
  });

  it('HubService and its logic never import admin', () => {
    for (const f of ['rpc/core.ts', 'rpc/hub-service.ts']) expect(readFileSync(join(SRC, f), 'utf8')).not.toMatch(/admin/);
  });
});
