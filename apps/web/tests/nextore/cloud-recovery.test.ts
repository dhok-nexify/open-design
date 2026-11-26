import { afterEach, describe, expect, it, vi } from 'vitest';

// features.ts resolves the edition once at import time, so each case re-imports
// the policy module after setting the public env var.
async function loadPolicy(edition: 'nextore' | 'upstream') {
  vi.stubEnv('NEXT_PUBLIC_OD_EDITION', edition);
  vi.resetModules();
  return import('../../src/nextore/cloud-recovery');
}

describe('resolveCloudRecoveryActions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('offers no Cloud recovery action in the NexTore edition', async () => {
    const { resolveCloudRecoveryActions } = await loadPolicy('nextore');

    expect(resolveCloudRecoveryActions({
      failedAgentId: 'byok-opencode',
      hasRetry: true,
      hasSwitchTarget: true,
    })).toEqual({ cloudRetry: false, switchToCloud: false });
    expect(resolveCloudRecoveryActions({
      failedAgentId: 'amr',
      hasRetry: true,
      hasSwitchTarget: true,
    })).toEqual({ cloudRetry: false, switchToCloud: false });
  });

  it('keeps the upstream Cloud retry and switch split', async () => {
    const { resolveCloudRecoveryActions } = await loadPolicy('upstream');

    expect(resolveCloudRecoveryActions({
      failedAgentId: 'amr',
      hasRetry: true,
      hasSwitchTarget: true,
    })).toEqual({ cloudRetry: true, switchToCloud: false });
    expect(resolveCloudRecoveryActions({
      failedAgentId: 'byok-opencode',
      hasRetry: true,
      hasSwitchTarget: true,
    })).toEqual({ cloudRetry: false, switchToCloud: true });
    expect(resolveCloudRecoveryActions({
      failedAgentId: 'claude',
      hasRetry: true,
      hasSwitchTarget: false,
    })).toEqual({ cloudRetry: false, switchToCloud: false });
  });
});
