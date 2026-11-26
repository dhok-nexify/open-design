import { afterEach, describe, expect, it, vi } from 'vitest';

// The probe caches per module instance, so each case loads a fresh copy.
async function loadHealth() {
  vi.resetModules();
  return import('../src/nextore/health-sandbox.js');
}

describe('sandbox health egress posture', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('reports the relay and the model proxy together', async () => {
    vi.stubEnv('OD_SANDBOX', 'noop');
    vi.stubEnv('OD_SANDBOX_EGRESS', 'relay');
    const { readSandboxHealth } = await loadHealth();

    expect(readSandboxHealth('nextore')?.egress).toEqual({ relay: true, modelProxy: true });
  });

  it('reports nothing on when both switches are off', async () => {
    vi.stubEnv('OD_SANDBOX', 'noop');
    vi.stubEnv('OD_SANDBOX_EGRESS', '');
    vi.stubEnv('OD_BYOK_PROXY', '');
    const { readSandboxHealth } = await loadHealth();

    expect(readSandboxHealth('nextore')?.egress).toEqual({ relay: false, modelProxy: false });
  });

  it('keeps the explicit proxy override visible', async () => {
    vi.stubEnv('OD_SANDBOX', 'noop');
    vi.stubEnv('OD_SANDBOX_EGRESS', '');
    vi.stubEnv('OD_BYOK_PROXY', 'on');
    const { readSandboxHealth } = await loadHealth();

    expect(readSandboxHealth('nextore')?.egress).toEqual({ relay: false, modelProxy: true });
  });

  it('stays undefined outside the edition', async () => {
    const { readSandboxHealth } = await loadHealth();
    expect(readSandboxHealth('upstream')).toBeUndefined();
  });
});
