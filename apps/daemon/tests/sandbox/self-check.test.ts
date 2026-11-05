import { describe, expect, it, vi } from 'vitest';

import { checkBwrap } from '../../src/sandbox/self-check.js';

describe('checkBwrap', () => {
  it('reports a missing binary as not_found', () => {
    const run = vi.fn(() => {
      throw Object.assign(new Error('spawn bwrap ENOENT'), { code: 'ENOENT' });
    });
    expect(checkBwrap({ bwrapPath: '/usr/bin/bwrap', run })).toEqual({
      ok: false,
      reason: 'not_found',
      detail: '/usr/bin/bwrap',
    });
  });

  it('reports a probe the kernel or AppArmor refuses', () => {
    const run = vi.fn(() => {
      throw new Error('bwrap: setting up uid map: Permission denied');
    });
    const result = checkBwrap({ run });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('probe_failed');
    expect(result.detail).toContain('Permission denied');
  });

  it('accepts a working bubblewrap', () => {
    const run = vi.fn();
    expect(checkBwrap({ run })).toEqual({ ok: true });
    expect(run).toHaveBeenCalledOnce();
  });
});
