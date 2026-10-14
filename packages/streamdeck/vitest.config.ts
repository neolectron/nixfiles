import { defineConfig } from 'vitest/config';

// Vitest requires its configuration as a default export.
// oxlint-disable-next-line import/no-default-export
export default defineConfig({
  test: { include: ['test/*.test.{ts,tsx}'], testTimeout: 15_000 },
});
