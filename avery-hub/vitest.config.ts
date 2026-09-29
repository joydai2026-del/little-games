import { defineConfig } from 'vitest/config';

// Plain Node tests, like the sibling games. `cloudflare:workers` only exists
// inside the Workers runtime, so tests swap in a tiny local stand-in.
export default defineConfig({
  resolve: {
    alias: { 'cloudflare:workers': new URL('./tests/support/cf-workers-stub.ts', import.meta.url).pathname },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Generous: RSA key generation per test is slow on a loaded machine; logic is deterministic.
    testTimeout: 30_000,
  },
});
