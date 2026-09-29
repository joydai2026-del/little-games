// A D1Database over Node's built-in SQLite: real SQL, real constraints, real
// foreign keys. Every call yields to the event loop first, so concurrent
// callers interleave the way separate D1 calls do, and a batch runs inside one
// transaction (D1: "Batched statements are SQL transactions").
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = decodeURIComponent(new URL('../..', import.meta.url).pathname);

type Row = Record<string, unknown>;

function norm(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
function out(row: Row | undefined): Row | null {
  if (!row) return null;
  const r: Row = {};
  for (const [k, v] of Object.entries(row)) r[k] = typeof v === 'bigint' ? Number(v) : v;
  return r;
}

class FakeStatement {
  params: unknown[] = [];
  constructor(readonly db: FakeD1, readonly sql: string) {}
  bind(...params: unknown[]): FakeStatement {
    const s = new FakeStatement(this.db, this.sql);
    s.params = params.map(norm);
    return s;
  }
  runSync(): { results: Row[]; meta: { changes: number } } {
    const stmt = this.db.raw.prepare(this.sql);
    const isRead = /^\s*(SELECT|WITH)/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql);
    if (isRead) {
      const rows = stmt.all(...this.params).map((r) => out(r)!);
      return { results: rows, meta: { changes: /^\s*SELECT/i.test(this.sql) ? 0 : rows.length } };
    }
    const r = stmt.run(...this.params);
    return { results: [], meta: { changes: Number(r.changes) } };
  }
  async first<T = Row>(col?: string): Promise<T | null> {
    await this.db.tick();
    const row = this.runSync().results[0] ?? null;
    if (row && col) return (row[col] as T) ?? null;
    return row as T | null;
  }
  async all<T = Row>(): Promise<{ results: T[]; success: true; meta: { changes: number } }> {
    await this.db.tick();
    const r = this.runSync();
    return { results: r.results as T[], success: true, meta: r.meta };
  }
  async run(): Promise<{ success: true; meta: { changes: number }; results: Row[] }> {
    await this.db.tick();
    const r = this.runSync();
    return { success: true, meta: r.meta, results: r.results };
  }
}

export class FakeD1 {
  readonly raw: DatabaseSync;
  constructor() {
    this.raw = new DatabaseSync(':memory:');
    this.raw.exec('PRAGMA foreign_keys = ON;');
  }
  async tick(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
  }
  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }
  async batch(stmts: FakeStatement[]): Promise<{ success: true; meta: { changes: number }; results: Row[] }[]> {
    await this.tick();
    this.raw.exec('BEGIN');
    try {
      const res = stmts.map((s) => {
        const r = s.runSync();
        return { success: true as const, meta: r.meta, results: r.results };
      });
      this.raw.exec('COMMIT');
      return res;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
  async exec(sql: string): Promise<void> {
    this.raw.exec(sql);
  }
}

export function migrationFiles(): string[] {
  const dir = join(ROOT, 'migrations');
  return readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().map((f) => join(dir, f));
}

/** A fresh database with every migration applied, typed as D1Database. */
export function freshDb(): FakeD1 & D1Database {
  const db = new FakeD1();
  for (const f of migrationFiles()) db.raw.exec(readFileSync(f, 'utf8'));
  return db as unknown as FakeD1 & D1Database;
}
