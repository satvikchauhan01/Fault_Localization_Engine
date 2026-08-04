import { defineConfig } from 'vitest/config';
import path from 'path';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Load .env from apps/backend so DATABASE_URL is available for integration tests
  const env = loadEnv(mode ?? 'test', path.resolve(__dirname, 'apps/backend'), '');

  return {
    test: {
      globalSetup: path.resolve(__dirname, 'vitest.global-setup.js'),
      globals: true,
      environment: 'node',
      fileParallelism: false,
      include: ['**/*.test.js'],
      exclude: ['**/node_modules/**', '**/dist/**'],
      env,
    },
    resolve: {
      alias: {
        '@domain': path.resolve(__dirname, './packages/domain/src'),
      },
    },
  };
});
