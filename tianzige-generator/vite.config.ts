import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  build: { outDir: 'dist/client' },
  // css: true so tests can read public/sheet.css?raw (vitest blanks CSS by default).
  test: { environment: 'node', include: ['tests/**/*.test.ts'], css: true },
});
