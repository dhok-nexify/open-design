import { describe, expect, it } from 'vitest';

import { authStartUrl } from '../src/nextore/auth-entry';

/**
 * One rule, two callers (sign-in again, silent re-authentication). A return
 * path that escapes the origin would turn the login redirect into an open
 * redirect, so this is the guard both flows depend on.
 */
describe('authStartUrl', () => {
  it('keeps a same-origin path and encodes it', () => {
    expect(authStartUrl('/projects/p1?ws=2')).toBe('/auth/start?return=%2Fprojects%2Fp1%3Fws%3D2');
  });

  it('falls back to the app root for anything that is not a path', () => {
    expect(authStartUrl('//evil.test')).toBe('/auth/start?return=%2F');
    expect(authStartUrl('https://evil.test')).toBe('/auth/start?return=%2F');
    expect(authStartUrl('')).toBe('/auth/start?return=%2F');
    expect(authStartUrl()).toBe('/auth/start?return=%2F');
  });
});
