// wrangler environments do NOT inherit bindings or vars but DO inherit routes.
// env.staging must repeat every binding, set routes to [], and differ from
// production vars only where it should.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname);

function readConfig(): Record<string, any> {
  const text = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
  return JSON.parse(text) as Record<string, any>;
}

const ALLOWED_VAR_DIFFS = ['DB_READY', 'HUB_ORIGIN', 'GAME_REGISTRY', 'GOOGLE_CLIENT_ID', 'ACCESS_JWKS_URL', 'ACCESS_ISSUER', 'ACCESS_AUD'];

describe('wrangler config', () => {
  const top = readConfig();
  const staging = top.env?.staging;

  it('production: hub.averystudio.org custom domain, no workers.dev, no preview URLs', () => {
    expect(top.name).toBe('avery-hub');
    expect(top.workers_dev).toBe(false);
    expect(top.preview_urls).toBe(false);
    expect(top.routes).toEqual([{ pattern: 'hub.averystudio.org', custom_domain: true }]);
    expect(top.vars.HUB_ORIGIN).toBe('https://hub.averystudio.org');
  });

  it('staging: its own worker on workers.dev with no custom domain', () => {
    expect(staging.name).toBe('avery-hub-staging');
    expect(staging.workers_dev).toBe(true);
    expect(staging.routes).toEqual([]);
    expect(staging.vars.HUB_ORIGIN).toBe('https://avery-hub-staging.joyd-ai-2026.workers.dev');
    expect(staging.d1_databases[0].database_name).toBe('avery_hub_staging');
    expect(staging.d1_databases[0].database_id).not.toBe(top.d1_databases[0].database_id);
  });

  for (const key of ['durable_objects', 'migrations', 'observability', 'assets']) {
    it(`staging repeats the top-level ${key} exactly`, () => {
      expect(staging[key]).toEqual(top[key]);
    });
  }

  it('staging repeats every rate limiter with the same limits but its OWN namespace ids', () => {
    const shape = (r: any[]) => r.map((x) => ({ name: x.name, simple: x.simple }));
    expect(shape(staging.ratelimits)).toEqual(shape(top.ratelimits));
    const prodIds = new Set(top.ratelimits.map((x: any) => x.namespace_id));
    for (const x of staging.ratelimits) expect(prodIds.has(x.namespace_id), x.name).toBe(false);
    expect(new Set(staging.ratelimits.map((x: any) => x.namespace_id)).size).toBe(staging.ratelimits.length);
  });

  it('production refuses to serve until its D1 id is real (DB_READY false with the placeholder)', () => {
    expect(top.d1_databases[0].database_id).toBe('REPLACE_WITH_PRODUCTION_D1_ID');
    expect(top.vars.DB_READY).toBe('false');
    expect(staging.vars.DB_READY).toBe('true');
    expect(top.vars.FREE_TIER_ENABLED).toBe('false');
    expect(staging.vars.FREE_TIER_ENABLED).toBe('false');
  });

  it('staging repeats the D1 binding (name and migrations dir)', () => {
    const strip = (d: any) => ({ binding: d.binding, migrations_dir: d.migrations_dir });
    expect(staging.d1_databases.map(strip)).toEqual(top.d1_databases.map(strip));
  });

  it('staging has every var production has, differing only where allowed', () => {
    expect(Object.keys(staging.vars).sort()).toEqual(Object.keys(top.vars).sort());
    for (const k of Object.keys(top.vars)) if (!ALLOWED_VAR_DIFFS.includes(k)) expect(staging.vars[k], k).toEqual(top.vars[k]);
  });

  it('both registries list the same six games and modes', () => {
    const shape = (r: Record<string, any>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.modes]));
    expect(shape(staging.vars.GAME_REGISTRY)).toEqual(shape(top.vars.GAME_REGISTRY));
    expect(Object.keys(top.vars.GAME_REGISTRY).sort()).toEqual(['dictation-dash', 'missing-stroke', 'stroke-reveal', 'tianzige', 'trace-race', 'vocab']);
  });

  it('JJ-set policy defaults', () => {
    expect(top.vars).toMatchObject({
      FREE_MODE_SWITCH_COOLDOWN_DAYS: '5', FREE_TASTE_ROUNDS_PER_DAY: '1', TRIAL_DAYS: '0', ANON_FREE_ROUNDS: 'unlimited',
      FREE_LIST_LIMIT: '1', SUPPORT_EMAIL: 'hello@averystudio.org',
    });
  });
});
