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
      exclude: [
        // type-only / bootstrapping / wiring — not unit-testable without a real ADO server
        'src/types/**',
        'src/**/*.future.ts',
        'src/index.ts',
        'src/health.ts',
        'src/mcp/**',          // Zod schema wiring + thin service calls
        'src/logging/**',      // pino bootstrap
        'src/config/**',       // env/Zod validation (needs real env vars)
        'src/domain/reviewScope.ts',   // discriminated-union types only
        'src/domain/confidence.ts',    // type aliases only
        // thin REST wrappers tested implicitly via service tests
        'src/ado/apiVersionLadder.ts',
        'src/ado/fieldsClient.ts',
        'src/ado/projectsClient.ts',
        'src/ado/wiqlClient.ts',
        'src/ado/workItemsClient.ts',
        'src/auth/authContext.ts',
      ],
      thresholds: {
        branches: 70,
        lines: 80,
      },
    },
  },
});
