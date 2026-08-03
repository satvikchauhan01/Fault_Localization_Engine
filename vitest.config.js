import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.js'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
  resolve: {
    alias: {
      '@domain': path.resolve(__dirname, './packages/domain/src'),
    },
  },
});
