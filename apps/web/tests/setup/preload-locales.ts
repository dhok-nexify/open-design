import { beforeAll } from 'vitest';

import { ensureDict } from '../../src/i18n';
import { LOCALES } from '../../src/i18n/types';

// Locale dictionaries are chunked in production (only en/zh-CN/zh-TW are eager).
// Component tests render synchronously and assert localized copy immediately, so
// load every chunk once per test file before any test runs.
beforeAll(async () => {
  await Promise.all(LOCALES.map((locale) => ensureDict(locale)));
}, 120_000);
