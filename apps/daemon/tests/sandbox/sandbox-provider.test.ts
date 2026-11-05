import { describe, expect, it, vi } from 'vitest';

import { buildBwrapArgs, SANDBOX_HOME } from '../../src/sandbox/bwrap-provider.js';
import { scrubSandboxEnv } from '../../src/sandbox/env-scrub.js';
import { resolveSandboxProvider } from '../../src/sandbox/index.js';

const request = {
  command: '/opt/opencode/bin/opencode',
  args: ['run', '--dir', '/srv/projects/p1'],
  cwd: '/srv/projects/p1',
  env: {
    PATH: '/usr/bin',
    OD_PROJECT_ID: 'p1',
    OD_DATA_DIR: '/var/lib/designer',
    OD_API_TOKEN: 'secret',
    NEXTORE_API_KEY: 'secret',
    NEXTORE_CLIENT_SECRET: 'secret',
    DESIGNER_SECRET_FILE: '/run/secret',
    GITHUB_TOKEN: 'secret',
    AWS_SECRET_ACCESS_KEY: 'secret',
  },
};

describe('scrubSandboxEnv', () => {
  it('drops daemon paths, dataset credentials and the session secret', () => {
    const env = scrubSandboxEnv(request.env);
    expect(env).toEqual({ PATH: '/usr/bin', OD_PROJECT_ID: 'p1' });
  });

  it('keeps runtime variables the agent actually needs', () => {
    const env = scrubSandboxEnv({ OD_PROJECT_ID: 'p1', OD_VENDOR_BASE: '/vendor', HOME: '/home/u' });
    expect(env).toEqual({ OD_PROJECT_ID: 'p1', OD_VENDOR_BASE: '/vendor', HOME: '/home/u' });
  });
});

describe('resolveSandboxProvider', () => {
  it('keeps the direct spawn upstream', () => {
    const provider = resolveSandboxProvider({ edition: 'upstream', platform: 'linux' });
    expect(provider.id).toBe('noop');
    expect(provider.check).toEqual({ ok: true });
  });

  it('runs bubblewrap in the NexTore edition', () => {
    const provider = resolveSandboxProvider({
      edition: 'nextore',
      platform: 'linux',
      env: {},
      check: () => ({ ok: true }),
    });
    expect(provider.id).toBe('bwrap');
    const wrapped = provider.wrap(request);
    expect(wrapped.command).toBe('bwrap');
    expect(wrapped.args).toEqual(buildBwrapArgs(request));
    expect(wrapped.env).toEqual({ PATH: '/usr/bin', OD_PROJECT_ID: 'p1', HOME: SANDBOX_HOME });
  });

  it('fails closed on an unsupported platform in production', () => {
    const provider = resolveSandboxProvider({
      edition: 'nextore',
      platform: 'darwin',
      env: { NODE_ENV: 'production' },
    });
    expect(provider.id).toBe('bwrap');
    expect(provider.check).toMatchObject({ ok: false, reason: 'unsupported_platform' });
  });

  it('surfaces a failed probe in production so the run path can fail closed', () => {
    const provider = resolveSandboxProvider({
      edition: 'nextore',
      platform: 'linux',
      env: { NODE_ENV: 'production' },
      check: () => ({ ok: false, reason: 'not_found', detail: 'bwrap' }),
    });
    expect(provider.check).toEqual({ ok: false, reason: 'not_found', detail: 'bwrap' });
  });

  it('degrades to a direct spawn on a development host', () => {
    const provider = resolveSandboxProvider({
      edition: 'nextore',
      platform: 'darwin',
      env: { NODE_ENV: 'development' },
    });
    expect(provider.id).toBe('noop');
  });

  it('allows the documented development escape hatch', () => {
    const provider = resolveSandboxProvider({
      edition: 'nextore',
      platform: 'linux',
      env: { NODE_ENV: 'production', OD_SANDBOX: 'noop' },
      check: vi.fn(() => ({ ok: true })),
    });
    expect(provider.id).toBe('noop');
  });
});

describe('buildBwrapArgs', () => {
  it('mounts the host read-only and re-binds only the project writable', () => {
    const args = buildBwrapArgs(request);
    const roBind = args.indexOf('--ro-bind');
    expect(args.slice(roBind, roBind + 3)).toEqual(['--ro-bind', '/', '/']);
    const bind = args.indexOf('--bind');
    expect(args.slice(bind, bind + 3)).toEqual(['--bind', '/srv/projects/p1', '/srv/projects/p1']);
    expect(args).toContain('--chdir');
    expect(args.slice(args.indexOf('--'))).toEqual([
      '--',
      '/opt/opencode/bin/opencode',
      'run',
      '--dir',
      '/srv/projects/p1',
    ]);
  });

  it('gives the sandbox a throwaway HOME', () => {
    const args = buildBwrapArgs(request);
    const home = args.indexOf(SANDBOX_HOME);
    expect(home).toBeGreaterThan(-1);
    expect(args[home - 1]).toBe('--tmpfs');
    expect(args[args.indexOf('--setenv') + 1]).toBe('HOME');
  });

  it('keeps the sandbox tied to the daemon and its own session', () => {
    const args = buildBwrapArgs(request);
    expect(args).toContain('--die-with-parent');
    expect(args).toContain('--new-session');
    expect(args).toContain('--unshare-pid');
  });
});
