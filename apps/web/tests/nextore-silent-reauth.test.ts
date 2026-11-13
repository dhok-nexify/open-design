// @vitest-environment jsdom
/**
 * Silent re-authentication is the Designer's only way to notice a sign-out or
 * an account switch at the site (NXD-D41), so its guards matter: never in a
 * hidden tab, never on a foreign return path, and never in a retry loop when
 * the site refuses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SILENT_REAUTH_COOLDOWN_MS,
  shouldSilentlyRevalidate,
  silentReauthAllowed,
  silentReauthUrl,
} from '../src/nextore/silent-reauth';

async function loadEditionModule() {
  vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'nextore');
  vi.resetModules();
  return import('../src/nextore/silent-reauth');
}

afterEach(() => {
  vi.unstubAllEnvs();
  window.sessionStorage.clear();
});

describe('silentReauthUrl', () => {
  it('keeps the return path same-origin', () => {
    expect(silentReauthUrl('/projects/p1?ws=2')).toBe('/auth/start?return=%2Fprojects%2Fp1%3Fws%3D2');
    expect(silentReauthUrl('//evil.test')).toBe('/auth/start?return=%2F');
    expect(silentReauthUrl('')).toBe('/auth/start?return=%2F');
  });
});

describe('shouldSilentlyRevalidate', () => {
  it('only fires in a visible tab the daemon flagged', () => {
    expect(shouldSilentlyRevalidate(true, 'visible')).toBe(true);
    expect(shouldSilentlyRevalidate(true, 'hidden')).toBe(false);
    expect(shouldSilentlyRevalidate(false, 'visible')).toBe(false);
  });
});

describe('silentReauthAllowed', () => {
  it('allows the first attempt and blocks the retry window', () => {
    expect(silentReauthAllowed(null, 1_000)).toBe(true);
    expect(silentReauthAllowed(1_000, 1_000 + SILENT_REAUTH_COOLDOWN_MS - 1)).toBe(false);
    expect(silentReauthAllowed(1_000, 1_000 + SILENT_REAUTH_COOLDOWN_MS)).toBe(true);
  });

  it('treats a corrupt marker as no attempt at all', () => {
    expect(silentReauthAllowed(Number.NaN, 1_000)).toBe(true);
  });
});

describe('attempt marker', () => {
  it('remembers the attempt per tab and forgets it on demand', async () => {
    const mod = await loadEditionModule();
    expect(mod.lastSilentReauthAttempt()).toBeNull();

    mod.markSilentReauthAttempt(5_000);
    expect(mod.lastSilentReauthAttempt()).toBe(5_000);
    expect(silentReauthAllowed(mod.lastSilentReauthAttempt(), 6_000)).toBe(false);

    mod.resetSilentReauthAttempt();
    expect(mod.lastSilentReauthAttempt()).toBeNull();
  });

  it('stays silent upstream, where there is no NexTore session to revalidate', async () => {
    vi.stubEnv('NEXT_PUBLIC_OD_EDITION', 'upstream');
    vi.resetModules();
    const mod = await import('../src/nextore/silent-reauth');

    mod.markSilentReauthAttempt(5_000);
    expect(mod.lastSilentReauthAttempt()).toBeNull();
  });
});
