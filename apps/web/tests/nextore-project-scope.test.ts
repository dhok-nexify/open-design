import { describe, expect, it } from 'vitest';

import {
  applyProjectScope,
  parseProjectScope,
  scopeToParam,
} from '../src/nextore/project-scope';

describe('parseProjectScope', () => {
  it('reads every scope form', () => {
    expect(parseProjectScope('')).toBeNull();
    expect(parseProjectScope('?ws=all')).toEqual({ kind: 'all' });
    expect(parseProjectScope('?ws=shared')).toEqual({ kind: 'shared' });
    expect(parseProjectScope('?ws=12')).toEqual({ kind: 'workspace', id: 12 });
  });

  it('ignores a malformed id instead of throwing', () => {
    expect(parseProjectScope('?ws=0')).toBeNull();
    expect(parseProjectScope('?ws=-3')).toBeNull();
    expect(parseProjectScope('?ws=abc')).toBeNull();
  });
});

describe('applyProjectScope', () => {
  it('writes the scope and keeps unrelated parameters', () => {
    expect(applyProjectScope('?view=recent', { kind: 'all' })).toBe('?view=recent&ws=all');
    expect(applyProjectScope('?ws=all', { kind: 'workspace', id: 7 })).toBe('?ws=7');
    expect(applyProjectScope('?ws=7', null)).toBe('');
    expect(scopeToParam({ kind: 'shared' })).toBe('shared');
  });
});
