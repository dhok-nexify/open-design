import { describe, expect, it } from 'vitest';

import { previewScopeMemberMismatch } from '../src/preview-scope-member.js';

describe('previewScopeMemberMismatch', () => {
  it('accepts the member who minted the scope', () => {
    expect(previewScopeMemberMismatch({ memberId: 7 }, 7)).toBe(false);
  });

  it('rejects another member holding the same URL', () => {
    expect(previewScopeMemberMismatch({ memberId: 7 }, 8)).toBe(true);
  });

  it('rejects a caller with no member identity', () => {
    expect(previewScopeMemberMismatch({ memberId: 7 }, null)).toBe(true);
    expect(previewScopeMemberMismatch({ memberId: 7 }, undefined)).toBe(true);
  });

  it('keeps an unbound scope usable (upstream and headless exports)', () => {
    expect(previewScopeMemberMismatch({}, 8)).toBe(false);
    expect(previewScopeMemberMismatch({ memberId: null }, 8)).toBe(false);
    expect(previewScopeMemberMismatch(null, 8)).toBe(false);
  });
});
