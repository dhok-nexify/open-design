import { describe, expect, it } from 'vitest';

import { resolveBasePath, withBasePath } from '../../src/runtime/base-path';

describe('P09 base path', () => {
  it('leaves URLs unchanged when no base path is configured', () => {
    expect(resolveBasePath(undefined)).toBe('');
    expect(resolveBasePath('')).toBe('');
    expect(withBasePath('', '/api/projects')).toBe('/api/projects');
    expect(withBasePath('', 'auth/start')).toBe('auth/start');
  });

  it('prefixes app-absolute paths when a base path is set', () => {
    expect(resolveBasePath('/designer/')).toBe('/designer');
    expect(withBasePath('/designer', '/api/projects')).toBe('/designer/api/projects');
    expect(withBasePath('/designer', 'auth/start')).toBe('/designer/auth/start');
  });
});
