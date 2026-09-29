// The few Node pieces the tests use (no @types/node in this package on purpose,
// matching the sibling games).
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): Record<string, unknown>[];
      get(...params: unknown[]): Record<string, unknown> | undefined;
      run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    };
  }
}
declare module 'node:fs' {
  export function readFileSync(path: string, enc: 'utf8'): string;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
interface ImportMeta {
  readonly url: string;
}
