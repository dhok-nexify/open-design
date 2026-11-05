import { afterEach, describe, expect, it, vi } from 'vitest';

// features.ts resolves the edition once at import time, so each case re-imports
// the config module after setting the public env var.
describe('mergeDaemonConfig — NexTore telemetry gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('keeps daemon telemetry upstream', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'upstream');
    vi.resetModules();
    const { DEFAULT_CONFIG, mergeDaemonConfig } = await import('../../src/state/config');

    const merged = mergeDaemonConfig(
      { ...DEFAULT_CONFIG },
      { telemetry: { metrics: true, content: true } },
    );

    expect(merged.telemetry?.metrics).toBe(true);
  });

  it('forces telemetry off in the NexTore edition', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
    vi.resetModules();
    const { DEFAULT_CONFIG, mergeDaemonConfig } = await import('../../src/state/config');

    const merged = mergeDaemonConfig(
      { ...DEFAULT_CONFIG },
      { telemetry: { metrics: true, content: true } },
    );

    expect(merged.telemetry).toEqual({ metrics: false, content: false, artifactManifest: false });
  });
});

describe('edition design system default', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to the bundled nextore design system in the edition', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
    vi.resetModules();
    const { DEFAULT_CONFIG } = await import('../../src/state/config');
    expect(DEFAULT_CONFIG.designSystemId).toBe('nextore');
  });

  it('keeps no default design system upstream', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'upstream');
    vi.resetModules();
    const { DEFAULT_CONFIG } = await import('../../src/state/config');
    expect(DEFAULT_CONFIG.designSystemId).toBeNull();
  });

  it('fills the edition default when the daemon has none', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
    vi.resetModules();
    const { DEFAULT_CONFIG, mergeDaemonConfig } = await import('../../src/state/config');
    const merged = mergeDaemonConfig({ ...DEFAULT_CONFIG, designSystemId: null }, {});
    expect(merged.designSystemId).toBe('nextore');
  });
});
