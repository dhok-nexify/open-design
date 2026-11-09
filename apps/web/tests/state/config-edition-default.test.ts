import { afterEach, describe, expect, it, vi } from 'vitest';

describe('edition design-system default migration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('migrates the legacy default id to nextore in the edition', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
    vi.resetModules();
    const { DEFAULT_CONFIG, mergeDaemonConfig } = await import('../../src/state/config');
    const merged = mergeDaemonConfig({ ...DEFAULT_CONFIG, designSystemId: 'default' }, {});
    expect(merged.designSystemId).toBe('nextore');
  });
});
