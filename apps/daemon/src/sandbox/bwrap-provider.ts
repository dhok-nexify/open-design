import { scrubSandboxEnv } from './env-scrub.js';
import type { SandboxCheck, SandboxCommand, SandboxProvider, SandboxRequest } from './provider.js';

export interface BwrapProviderOptions {
  bwrapPath: string;
  check: SandboxCheck;
}

/** Where the sandboxed process sees its home. Lives in a tmpfs, so it is gone after the run. */
export const SANDBOX_HOME = '/tmp/od-sandbox-home';

/**
 * bubblewrap argument builder.
 *
 * The whole filesystem is mounted read-only, then the run's working directory
 * is re-bound read-write on top of it. Nothing else becomes writable, so `ls ..`
 * still sees the host layout but `cat`/`touch` outside the project fail. HOME is
 * a tmpfs so agent state cannot leak between runs and disappears with the
 * sandbox. The network is shared because the agent reaches the daemon's BYOK
 * proxy on loopback; egress policy is a separate layer (NXD-P01).
 *
 * `--new-session` plus `--die-with-parent` keep job control and signal
 * handling intact while guaranteeing the sandbox dies with the daemon, which is
 * what makes run cancellation kill the whole tree.
 */
export function buildBwrapArgs(request: SandboxRequest): string[] {
  const cwd = request.cwd;
  return [
    '--die-with-parent',
    '--new-session',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-ipc',
    '--share-net',
    '--ro-bind',
    '/',
    '/',
    '--bind',
    cwd,
    cwd,
    '--tmpfs',
    SANDBOX_HOME,
    '--setenv',
    'HOME',
    SANDBOX_HOME,
    '--tmpfs',
    '/tmp',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--chdir',
    cwd,
    '--',
    request.command,
    ...request.args,
  ];
}

export function createBwrapSandboxProvider(options: BwrapProviderOptions): SandboxProvider {
  return {
    id: 'bwrap',
    check: options.check,
    wrap(request: SandboxRequest): SandboxCommand {
      return {
        command: options.bwrapPath,
        args: buildBwrapArgs(request),
        env: { ...scrubSandboxEnv(request.env), HOME: SANDBOX_HOME },
      };
    },
  };
}
