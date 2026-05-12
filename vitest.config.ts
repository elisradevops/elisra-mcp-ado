import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/types/**', 'src/**/*.future.ts'],
      thresholds: {
        branches: 60,
        lines: 80,
      },
    },
  },
});
