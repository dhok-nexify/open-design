import { describe, expect, it, vi } from 'vitest';

import { SANDBOX_HOME } from '../../src/sandbox/bwrap-provider.js';
import { checkBwrap, describeBwrapProbeFailure } from '../../src/sandbox/self-check.js';

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

  it('prefers the bubblewrap stderr message over the command line', () => {
    const error = Object.assign(new Error('Command failed: /usr/bin/bwrap ...'), {
      stderr: Buffer.from('bwrap: setting up uid map: Permission denied\n'),
    });
    expect(describeBwrapProbeFailure(error)).toBe(
      'bwrap: setting up uid map: Permission denied',
    );
  });

  it('probes the same writable /tmp and HOME sequence the run uses', () => {
    const calls: string[][] = [];
    const run = (_file: string, args: readonly string[]) => {
      calls.push([...args]);
    };
    expect(checkBwrap({ run }).ok).toBe(true);
    const args = calls[0] ?? [];
    const tmpfsTmp = args.findIndex((arg, index) => arg === '--tmpfs' && args[index + 1] === '/tmp');
    const tmpfsHome = args.findIndex((arg, index) => arg === '--tmpfs' && args[index + 1] === SANDBOX_HOME);
    expect(tmpfsTmp).toBeGreaterThan(-1);
    expect(tmpfsHome).toBeGreaterThan(tmpfsTmp);
    expect(args).toContain(SANDBOX_HOME);
  });

  it('accepts a working bubblewrap', () => {
    const run = vi.fn();
    expect(checkBwrap({ run })).toEqual({ ok: true });
    expect(run).toHaveBeenCalledOnce();
  });
});
