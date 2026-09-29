// The ONLY place that touches the D1 binding (tests/structure.test.ts enforces
// it). Teacher data is reached only through forTeacher(); identity and session
// lookups that happen before a teacher is known live in identity.ts.
import type { Env } from '../env';

export type Db = D1Database;

export function openDb(env: Env): Db {
  return env.DB;
}

export * from './identity';
export * from './teacher';
