import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  esbuild: {
    jsx: 'automatic'
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['.opencode-review-*/**', '.worktrees/**', 'tests/e2e/**', 'node_modules/**']
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname)
    }
  }
});
