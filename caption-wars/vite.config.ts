import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist/client',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
