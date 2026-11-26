import { afterEach, describe, expect, it, vi } from 'vitest';

// features.ts resolves the edition once at import time, so each case re-imports
// the module after setting the public env var.
async function loadModule(edition: 'nextore' | 'upstream') {
  vi.stubEnv('NEXT_PUBLIC_OD_EDITION', edition);
  vi.resetModules();
  return import('../../src/components/project-actions/activeFileSharesBeforeDelete');
}

describe('activeFileSharesBeforeDelete', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('returns zero in the NexTore edition without calling the Cloud route', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { activeFileSharesBeforeDelete } = await loadModule('nextore');

    await expect(activeFileSharesBeforeDelete('p1', ['a.html'], null)).resolves.toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still requires a workspace identity upstream', async () => {
    const { activeFileSharesBeforeDelete } = await loadModule('upstream');

    await expect(activeFileSharesBeforeDelete('p1', ['a.html'], null))
      .rejects.toThrow(/workspace identity/);
  });
});
