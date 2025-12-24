import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Memory limits to prevent OOM
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 2, // Reduced from 4 to 2 to prevent memory leaks
        minThreads: 1,
        // Isolate each test file in its own worker
        isolate: true,
      },
    },
    // Increase timeout for slower tests due to reduced parallelism
    testTimeout: 15000,
    hookTimeout: 10000,
    // Force garbage collection between test files
    sequence: {
      hooks: 'list',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'tests/', '**/*.test.ts', '**/*.spec.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
