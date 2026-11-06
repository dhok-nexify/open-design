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
    testTimeout: 5_000,
    setupFiles: ['./tests/setup/jsdom-lexical.ts', './tests/setup/coalesced-get-reset.ts'],
  },
});
