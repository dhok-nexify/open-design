import { describe, expect, it } from 'vitest';

import {
  requiresRunProjectAuthorization,
  resolveNextorePermissionUrl,
} from '../src/nextore/authorization.js';

describe('NexTore run project authorization', () => {
  it('always authorizes the edition, even without an upstream binding', () => {
    expect(requiresRunProjectAuthorization({
      edition: 'nextore',
      hasBinding: false,
      hasRequestContext: false,
    })).toBe(true);
  });

  it('keeps the upstream headerless personal-project path', () => {
    expect(requiresRunProjectAuthorization({
      edition: 'upstream',
      hasBinding: false,
      hasRequestContext: false,
    })).toBe(false);
    expect(requiresRunProjectAuthorization({
      edition: 'upstream',
      hasBinding: true,
      visibility: 'personal',
      hasRequestContext: false,
    })).toBe(false);
  });

  it('authorizes upstream team or request-scoped projects', () => {
    expect(requiresRunProjectAuthorization({
      edition: 'upstream',
      hasBinding: true,
      visibility: 'team',
      hasRequestContext: false,
    })).toBe(true);
    expect(requiresRunProjectAuthorization({
      edition: 'upstream',
      hasBinding: true,
      visibility: 'personal',
      hasRequestContext: true,
    })).toBe(true);
  });
});

describe('resolveNextorePermissionUrl', () => {
  it('resolves a relative module URL against NexTore', () => {
    expect(resolveNextorePermissionUrl(
      '/PermissionSetting?id=7&redirect=x',
      'https://nextore.example',
    )).toBe('https://nextore.example/PermissionSetting?id=7&redirect=x');
  });

  it('rejects a different origin, protocol-relative URL and invalid URL', () => {
    expect(resolveNextorePermissionUrl('https://evil.example/PermissionSetting', 'https://nextore.example')).toBeNull();
    expect(resolveNextorePermissionUrl('//evil.example/PermissionSetting', 'https://nextore.example')).toBeNull();
    expect(resolveNextorePermissionUrl('javascript:alert(1)', 'https://nextore.example')).toBeNull();
  });
});
