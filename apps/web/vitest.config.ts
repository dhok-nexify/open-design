import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// ESM-safe project root: the bundled config loader defines `__dirname`, but the
// native/runner loaders evaluate this file as a module where it does not exist.
const projectDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@excalidraw/excalidraw': resolve(projectDir, 'tests/helpers/excalidraw-mock.tsx'),
      'motion/react': resolve(projectDir, 'tests/helpers/motion-mock.tsx'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Keep this above the shared Testing Library asyncUtilTimeout so failed
    // waits retain Testing Library's assertion/DOM diagnostics.
    // jsdom re-parses the expanded stylesheet in the style-contract tests; on a
    // slower Windows box that parse alone can exceed the old 5 s / 10 s caps.
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // Windows native runs the jsdom-heavy suite with far less timer headroom
    // than CI's Linux runners. Capping workers keeps mount-heavy tests from
    // racing each other into spurious timeouts.
    ...(process.platform === 'win32' ? { maxWorkers: 6 } : {}),
    setupFiles: ['./tests/setup/jsdom-lexical.ts', './tests/setup/coalesced-get-reset.ts', './tests/setup/preload-locales.ts'],
  },
});
