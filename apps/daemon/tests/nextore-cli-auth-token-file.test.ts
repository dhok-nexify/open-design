import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyTokenFilePermissions } from '../src/nextore/auth/cli-client.js';

describe('P10 token file permissions', () => {
  it('chmods 0600 on POSIX', () => {
    const chmod = vi.fn();

    applyTokenFilePermissions('/tmp/token.json', 'linux', { chmod });

    expect(chmod).toHaveBeenCalledWith('/tmp/token.json', 0o600);
  });

  it('drops inheritance and grants only the user on Windows', () => {
    const spawnSyncFake = vi.fn(() => ({ status: 0 }));

    applyTokenFilePermissions('C:\\tmp\\token.json', 'win32', {
      spawnSync: spawnSyncFake as never,
      user: 'alice',
    });

    const [file, args, options] = spawnSyncFake.mock.calls[0]! as unknown as [string, string[], { timeout?: number }];
    expect(file).toBe('icacls');
    expect(args).toEqual(['C:\\tmp\\token.json', '/inheritance:r', '/grant:r', 'alice:F']);
    expect(options.timeout).toBe(5_000);
  });

  it('throws a recognizable error when icacls fails', () => {
    expect(() => applyTokenFilePermissions('C:\\tmp\\token.json', 'win32', {
      spawnSync: (() => ({ status: 5 })) as never,
      user: 'alice',
    })).toThrow(/token_file_permissions_failed/);
  });

  it.skipIf(process.platform !== 'win32')('(windows-only) leaves no Everyone/BUILTIN\\Users access', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'od-acl-'));
    const file = join(dir, 'token.json');
    try {
      await writeFile(file, '{}', 'utf8');
      applyTokenFilePermissions(file);
      const listed = spawnSync('icacls', [file], { encoding: 'utf8', timeout: 5_000 });
      const output = String(listed.stdout ?? '');
      // /inheritance:r must leave no inherited entries at all, not merely
      // without the two most obvious ones.
      expect(output).not.toMatch(/\(I\)/);
      expect(output).not.toMatch(/BUILTIN\\Users/i);
      expect(output).not.toMatch(/Everyone/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
