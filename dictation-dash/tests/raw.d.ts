// Vite's ?raw imports, used by tests to load committed fixtures byte-for-byte.
declare module '*?raw' {
  const content: string;
  export default content;
}

// The two Node pieces tests/harness.ts uses to read byte-exact fixtures
// (no @types/node in this package on purpose).
declare module 'node:fs' {
  export function readFileSync(path: URL | string): Uint8Array;
}
interface ImportMeta {
  readonly url: string;
}
